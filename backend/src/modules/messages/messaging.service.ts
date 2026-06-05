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
  } catch {
    return;
  }

  if (analysis.type === 'car_seat') {
    const stockCount = await db.carSeat.count({ where: { isActive: true } });
    const existing = await db.carSeatRequest.findFirst({ where: { rentalId: rental.id } });
    if (!existing) {
      await db.carSeatRequest.create({
        data: { vehicleId: rental.vehicleId, rentalId: rental.id },
      });
    }
    const reply = stockCount > 0
      ? analysis.suggestedReply
      : `Bonjour ${rental.driverName}, je suis désolé(e), nous n'avons pas de siège auto disponible pour votre location. ${assistantName}`;
    await sendOrDraftMessage(reply, settings.aiModeCarSeat ?? 'manual', rental, db, ga);
    return;
  }

  if (analysis.type === 'remise' || analysis.type === 'general') {
    await sendOrDraftMessage(analysis.suggestedReply, settings.aiModeGeneral ?? 'manual', rental, db, ga);
    return;
  }

  if (analysis.type === 'incident') {
    await createDraftMessage(analysis.suggestedReply, rental.id, db);
    return;
  }
  // remerciement → rien
}

async function sendOrDraftMessage(
  content: string,
  mode: string,
  rental: { id: string; getaroundId: string | null },
  db: PrismaClient,
  ga: GetaroundClient,
): Promise<void> {
  if (mode === 'auto' && rental.getaroundId) {
    try {
      await ga.sendMessage(parseInt(rental.getaroundId, 10), content);
      await db.message.create({
        data: { rentalId: rental.id, direction: 'outbound', content, sentAt: new Date(), status: 'sent' },
      });
    } catch (e) { console.error('[Messaging] Erreur envoi auto:', e); }
  } else if (mode === 'approval') {
    await createDraftMessage(content, rental.id, db);
  }
}

async function createDraftMessage(content: string, rentalId: string, db: PrismaClient): Promise<void> {
  await db.message.create({
    data: {
      rentalId,
      direction: 'outbound',
      content,
      status: 'pending_approval',
      aiSuggestion: content,
    },
  });
}
