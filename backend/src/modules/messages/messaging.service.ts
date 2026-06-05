import Anthropic from '@anthropic-ai/sdk';
import type { PrismaClient } from '../../generated/tenant';
import type { GetaroundClient } from '../getaround-sync/getaround-sync.service';

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface ProactiveAnalysis {
  type: 'car_seat' | 'remise' | 'incident' | 'general' | 'remerciement';
  urgent: boolean;
  details: { childAge?: number | null; question?: string | null; incidentType?: string | null };
  suggestedReply: string;
}

export type RentalForMessaging = {
  id: string;
  vehicleId: string;
  driverName: string;
  driverGetaroundId: string | null;
  getaroundId: string | null;
  startAt: Date;
  vehicle: { make: string; model: string; licensePlate: string; parkingZone: string | null };
};

export async function analyzeAndProcessMessage(
  message: { id: string; content: string },
  rental: RentalForMessaging,
  db: PrismaClient,
  ga: GetaroundClient,
): Promise<void> {
  const settings = await db.companySettings.findFirst({
    select: {
      aiModeCarSeat: true, aiModeIncident: true, aiModeGeneral: true,
      aiTone: true, aiName: true, senderName: true,
    },
  });
  if (!settings) return;

  const tone = settings.aiTone === 'tutoiement' ? 'tutoiement' : 'vouvoiement';
  const assistantName = settings.aiName ?? settings.senderName ?? 'Sun and Drive';

  // 1. Analyse Claude
  let analysis: ProactiveAnalysis;
  try {
    const resp = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      system: `Tu es ${assistantName} de Sun and Drive. Tu analyses les messages de locataires Getaround.
Réponds en JSON uniquement, sans markdown :
{"type":"car_seat"|"remise"|"incident"|"general"|"remerciement","urgent":boolean,"details":{"childAge":number|null,"question":string|null,"incidentType":string|null},"suggestedReply":string}
La réponse suggérée doit être en ${tone}, signée ${assistantName}.`,
      messages: [{
        role: 'user',
        content: `Message du locataire : "${message.content}"
Véhicule : ${rental.vehicle.make} ${rental.vehicle.model} (${rental.vehicle.licensePlate})
Lieu : ${rental.vehicle.parkingZone ?? 'Non défini'}
Début location : ${rental.startAt.toLocaleDateString('fr-FR')}
Locataire : ${rental.driverName}`,
      }],
    });
    const text = resp.content[0]?.type === 'text' ? resp.content[0].text : '{}';
    analysis = JSON.parse(text) as ProactiveAnalysis;
  } catch (error) {
    console.error('[Messaging] Erreur Claude API:', error);
    return;
  }

  // 2. Remerciement → toujours ignorer
  if (analysis.type === 'remerciement') {
    console.log(`[Messaging] Remerciement ignoré rental ${rental.id}`);
    return;
  }

  // 3. Déterminer le mode selon le type
  let mode: string;
  if (analysis.type === 'car_seat') {
    mode = settings.aiModeCarSeat ?? 'manual';
  } else if (analysis.type === 'incident') {
    mode = settings.aiModeIncident ?? 'approval';
  } else {
    mode = settings.aiModeGeneral ?? 'manual';
  }

  // 4. Adapter la réponse selon le type (siège auto + stock)
  let suggestedReply = analysis.suggestedReply;
  if (analysis.type === 'car_seat') {
    const stockCount = await db.carSeat.count({ where: { isActive: true } });
    const existing = await db.carSeatRequest.findFirst({ where: { rentalId: rental.id } });
    if (!existing) {
      await db.carSeatRequest.create({ data: { vehicleId: rental.vehicleId, rentalId: rental.id } });
    }
    if (stockCount === 0) {
      suggestedReply = `Bonjour ${rental.driverName}, je suis désolé(e), nous n'avons pas de siège auto disponible pour votre location. ${assistantName}`;
    }
  }

  const admins = await db.user.findMany({
    where: { role: 'admin', isActive: true },
    select: { id: true },
  });

  // 5. Agir selon le mode
  if (mode === 'auto') {
    try {
      if (rental.getaroundId) {
        await ga.sendMessage(parseInt(rental.getaroundId, 10), suggestedReply);
        await db.message.create({
          data: {
            rentalId: rental.id,
            direction: 'outbound',
            content: suggestedReply,
            sentAt: new Date(),
            status: 'sent',
            aiSuggestion: suggestedReply,
          },
        });
        console.log(`[Messaging] Auto-envoi message rental ${rental.id}`);
      }
    } catch (e) { console.error('[Messaging] Erreur envoi auto:', e); }
    return;
  }

  if (mode === 'approval') {
    await db.message.create({
      data: {
        rentalId: rental.id,
        direction: 'outbound',
        content: suggestedReply,
        status: 'pending_approval',
        aiSuggestion: suggestedReply,
      },
    });
    if (admins.length > 0) {
      await db.notification.createMany({
        data: admins.map(a => ({
          userId: a.id,
          type: 'message_pending_approval',
          title: `💬 Brouillon à valider — ${rental.driverName}`,
          body: message.content.slice(0, 80),
          relatedEntityType: 'rental',
          relatedEntityId: rental.id,
        })),
        skipDuplicates: true,
      });
    }
    console.log(`[Messaging] Brouillon créé rental ${rental.id}`);
    return;
  }

  // mode === 'manual'
  console.log(`[Messaging] Mode manuel — pas de brouillon rental ${rental.id}`);
  const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000);
  const hasRecentReply = await db.message.count({
    where: {
      rentalId: rental.id,
      direction: 'outbound',
      status: { in: ['sent', 'approved'] },
      createdAt: { gte: twoHoursAgo },
    },
  });
  if (hasRecentReply === 0 && admins.length > 0) {
    await db.notification.createMany({
      data: admins.map(a => ({
        userId: a.id,
        type: 'message_unanswered',
        title: `💬 Message sans réponse — ${rental.driverName}`,
        body: message.content.slice(0, 80),
        relatedEntityType: 'rental',
        relatedEntityId: rental.id,
      })),
      skipDuplicates: true,
    });
  }
}
