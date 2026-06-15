import Anthropic from '@anthropic-ai/sdk';
import { Resend } from 'resend';
import type { PrismaClient } from '../../generated/tenant';
import type { GetaroundClient } from '../getaround-sync/getaround-sync.service';

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function getResend(): Resend {
  return new Resend(process.env.RESEND_API_KEY);
}

const FROM_ADDR = process.env.RESEND_FROM ?? 'noreply@sunanddrive.fr';

function cleanClaudeJson(raw: string): string {
  return raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

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
  endAt: Date;
  status: string;
  vehicle: { make: string; model: string; licensePlate: string; parkingZone: string | null; deliveryPointName: string | null };
};

function toIcalDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function toGCalDate(d: Date): string {
  return toIcalDate(d);
}

function buildGoogleCalendarUrl(rental: RentalForMessaging): string {
  const location = rental.vehicle.deliveryPointName ?? rental.vehicle.parkingZone ?? '';
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `Siège auto — ${rental.driverName}`,
    dates: `${toGCalDate(rental.startAt)}/${toGCalDate(rental.endAt)}`,
    details: `Siège auto requis pour la location Getaround. Véhicule: ${rental.vehicle.make} ${rental.vehicle.model} (${rental.vehicle.licensePlate})`,
    location,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function buildIcal(rental: RentalForMessaging): string {
  const location = (rental.vehicle.deliveryPointName ?? rental.vehicle.parkingZone ?? '').replace(/,/g, '\\,');
  const description = `Siège auto requis\\, véhicule: ${rental.vehicle.make} ${rental.vehicle.model} (${rental.vehicle.licensePlate})`;
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SunandDrive//FR',
    'BEGIN:VEVENT',
    `UID:carseat-${rental.id}@sunanddrive`,
    `DTSTART:${toIcalDate(rental.startAt)}`,
    `DTEND:${toIcalDate(rental.endAt)}`,
    `SUMMARY:Siège auto — ${rental.driverName}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${location}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT48H',
    'ACTION:DISPLAY',
    'DESCRIPTION:Rappel siège auto dans 48h',
    'END:VALARM',
    'BEGIN:VALARM',
    'TRIGGER:-PT24H',
    'ACTION:DISPLAY',
    'DESCRIPTION:Rappel siège auto dans 24h',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

export async function sendCarSeatEmail(
  recipients: string[],
  rental: RentalForMessaging,
  assistantName: string,
  confirmed: boolean,
): Promise<void> {
  if (!process.env.RESEND_API_KEY || recipients.length === 0) return;
  const gcalUrl = buildGoogleCalendarUrl(rental);
  const icalContent = buildIcal(rental);
  const location = rental.vehicle.deliveryPointName ?? rental.vehicle.parkingZone ?? 'Non défini';
  const subject = confirmed
    ? `🪑 Siège auto confirmé — ${rental.driverName}`
    : `⚠️ Siège auto demandé — stock insuffisant (${rental.driverName})`;
  const html = confirmed
    ? `<p>Un siège auto a été attribué pour la location de <strong>${rental.driverName}</strong>.</p>
       <p>Véhicule&nbsp;: ${rental.vehicle.make} ${rental.vehicle.model} (${rental.vehicle.licensePlate})</p>
       <p>Point de remise&nbsp;: ${location}</p>
       <p>Période&nbsp;: ${rental.startAt.toLocaleDateString('fr-FR')} → ${rental.endAt.toLocaleDateString('fr-FR')}</p>
       <p><a href="${gcalUrl}" style="display:inline-block;padding:10px 20px;background:#01696e;color:#fff;border-radius:6px;text-decoration:none;">Ajouter au calendrier Google</a></p>
       <p style="color:#666;font-size:12px;">Le fichier .ics ci-joint peut être importé dans Apple Calendrier ou Outlook.</p>`
    : `<p><strong>⚠️ Siège auto indisponible</strong> pour la location de <strong>${rental.driverName}</strong>.</p>
       <p>Véhicule&nbsp;: ${rental.vehicle.make} ${rental.vehicle.model} (${rental.vehicle.licensePlate})</p>
       <p>Action requise&nbsp;: réapprovisionner le stock ou contacter le locataire.</p>`;

  await getResend().emails.send({
    from: `${assistantName} <${FROM_ADDR}>`,
    to: recipients,
    subject,
    html,
    attachments: confirmed
      ? [{ filename: 'siege-auto.ics', content: Buffer.from(icalContent), contentType: 'text/calendar' }]
      : undefined,
  });
}

export async function analyzeAndProcessMessage(
  message: { id: string; content: string },
  rental: RentalForMessaging,
  db: PrismaClient,
  ga: GetaroundClient,
): Promise<void> {
  console.log(`[Messaging] IA analyse message ${message.id} — rental ${rental.id} (${rental.driverName})`);
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
Lieu : ${rental.vehicle.deliveryPointName ?? rental.vehicle.parkingZone ?? 'Non défini'}
Début location : ${rental.startAt.toLocaleDateString('fr-FR')}
Locataire : ${rental.driverName}`,
      }],
    });
    const text = resp.content[0]?.type === 'text' ? resp.content[0].text : '{}';
    analysis = JSON.parse(cleanClaudeJson(text)) as ProactiveAnalysis;
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
    // Ignorer les demandes de siège sur locations terminées ou passées
    if (!['booked', 'active'].includes(rental.status) || rental.endAt <= new Date()) {
      console.log(`[Messaging] Demande siège ignorée — location passée (rental ${rental.id}, status=${rental.status})`);
      return;
    }
    const existing = await db.carSeatRequest.findFirst({ where: { rentalId: rental.id } });
    if (!existing) {
      const availableSeat = await db.carSeat.findFirst({ where: { isActive: true, availableStock: { gt: 0 } } });
      if (availableSeat) {
        await db.carSeat.update({
          where: { id: availableSeat.id },
          data: { availableStock: { decrement: 1 } },
        });
        await db.carSeatRequest.create({
          data: { vehicleId: rental.vehicleId, rentalId: rental.id, carSeatId: availableSeat.id, status: 'confirmed' },
        });
        const staff = await db.user.findMany({
          where: { role: { in: ['admin', 'carkeeper'] }, isActive: true },
          select: { email: true },
        });
        const emails = staff.map(u => u.email).filter(Boolean);
        void sendCarSeatEmail(emails, rental, assistantName, true).catch(e =>
          console.error('[Messaging] Erreur email siège auto:', e),
        );
        console.log(`[Messaging] Siège auto attribué rental ${rental.id}`);
      } else {
        await db.carSeatRequest.create({
          data: { vehicleId: rental.vehicleId, rentalId: rental.id, status: 'unavailable' },
        });
        const staff = await db.user.findMany({
          where: { role: { in: ['admin', 'carkeeper'] }, isActive: true },
          select: { email: true },
        });
        const emails = staff.map(u => u.email).filter(Boolean);
        void sendCarSeatEmail(emails, rental, assistantName, false).catch(e =>
          console.error('[Messaging] Erreur email alerte siège:', e),
        );
        suggestedReply = `Bonjour ${rental.driverName}, je suis désolé(e), nous n'avons pas de siège auto disponible pour votre location. Cordialement, ${assistantName}`;
        console.warn(`[Messaging] Stock siège auto épuisé — rental ${rental.id}`);
      }
    } else {
      if (existing.status === 'unavailable') {
        suggestedReply = `Bonjour ${rental.driverName}, je suis désolé(e), nous n'avons pas de siège auto disponible pour votre location. Cordialement, ${assistantName}`;
      }
    }
  }

  // Toujours sauvegarder aiSuggestion sur le message inbound source
  try {
    await db.message.update({ where: { id: message.id }, data: { aiSuggestion: suggestedReply } });
    console.log(`[Messaging] aiSuggestion sauvegardée — message ${message.id}`);
  } catch (e) {
    console.error('[Messaging] Erreur sauvegarde aiSuggestion:', e);
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

// ─── Relecture matinale des conversations ─────────────────────────────────────

export interface MorningReviewResult {
  rentalId: string;
  driverName: string;
  vehicleId: string;
  vehicleLabel: string;
  carSeatCaught: boolean;
  unansweredQuestion: boolean;
  incidentReported: boolean;
}

interface ConversationAnalysis {
  carSeatRequested: boolean;
  carSeatHandled: boolean;
  unansweredQuestion: boolean;
  incidentReported: boolean;
}

export async function morningConversationReview(
  rental: RentalForMessaging,
  messages: Array<{ direction: string; content: string }>,
  db: PrismaClient,
): Promise<MorningReviewResult> {
  const result: MorningReviewResult = {
    rentalId: rental.id,
    driverName: rental.driverName,
    vehicleId: rental.vehicleId,
    vehicleLabel: `${rental.vehicle.make} ${rental.vehicle.model} (${rental.vehicle.licensePlate})`,
    carSeatCaught: false,
    unansweredQuestion: false,
    incidentReported: false,
  };

  if (messages.length === 0) return result;

  const conversationText = messages
    .map(m => `[${m.direction === 'inbound' ? 'LOCATAIRE' : 'PROPRIÉTAIRE'}] ${m.content}`)
    .join('\n');

  let analysis: ConversationAnalysis;
  try {
    const resp = await claude.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      system: `Tu analyses une conversation entre un locataire et un propriétaire Getaround.
Réponds UNIQUEMENT en JSON valide, sans markdown :
{"carSeatRequested":bool,"carSeatHandled":bool,"unansweredQuestion":bool,"incidentReported":bool}
- carSeatRequested: le locataire a mentionné un besoin de siège auto enfant
- carSeatHandled: le propriétaire a répondu à cette demande de siège
- unansweredQuestion: le locataire a posé une question restée sans réponse du propriétaire
- incidentReported: un incident, dommage, problème ou accident est mentionné`,
      messages: [{ role: 'user', content: `Conversation rental ${rental.id} — ${rental.driverName} :\n${conversationText}` }],
    });
    const text = resp.content[0]?.type === 'text' ? resp.content[0].text : '{}';
    analysis = JSON.parse(cleanClaudeJson(text)) as ConversationAnalysis;
  } catch (err) {
    console.error(`[MorningReview] Erreur Claude rental ${rental.id}:`, err);
    return result;
  }

  const settings = await db.companySettings.findFirst({ select: { aiName: true, senderName: true } });
  const assistantName = settings?.aiName ?? settings?.senderName ?? 'Sun and Drive';

  const admins = await db.user.findMany({
    where: { isActive: true, OR: [{ role: 'admin' }, { roles: { has: 'admin' } }] },
    select: { id: true, email: true },
  });

  // 1. Siège auto demandé non traité → rattraper
  if (analysis.carSeatRequested && !analysis.carSeatHandled) {
    const existing = await db.carSeatRequest.findFirst({ where: { rentalId: rental.id } });
    if (!existing) {
      const availableSeat = await db.carSeat.findFirst({ where: { isActive: true, availableStock: { gt: 0 } } });
      if (availableSeat) {
        await db.carSeat.update({ where: { id: availableSeat.id }, data: { availableStock: { decrement: 1 } } });
        await db.carSeatRequest.create({
          data: { vehicleId: rental.vehicleId, rentalId: rental.id, carSeatId: availableSeat.id, status: 'confirmed' },
        });
        const staff = await db.user.findMany({
          where: { isActive: true, OR: [{ role: { in: ['admin', 'carkeeper'] } }, { roles: { hasSome: ['admin', 'carkeeper'] } }] },
          select: { email: true },
        });
        const emails = staff.map(u => u.email).filter(Boolean);
        void sendCarSeatEmail(emails, rental, assistantName, true).catch(e =>
          console.error('[MorningReview] Erreur email siège:', e),
        );
      } else {
        await db.carSeatRequest.create({
          data: { vehicleId: rental.vehicleId, rentalId: rental.id, status: 'unavailable' },
        });
      }
      console.log(`[MorningReview] Demande siège rattrapée — rentalId ${rental.id}`);
      result.carSeatCaught = true;
    }
  }

  // 2. Question sans réponse → notification
  if (analysis.unansweredQuestion && admins.length > 0) {
    await db.notification.createMany({
      data: admins.map(a => ({
        userId: a.id,
        type: 'unanswered_message',
        title: `❓ Question sans réponse — ${rental.driverName}`,
        body: `${rental.vehicle.make} ${rental.vehicle.model} (${rental.vehicle.licensePlate})`,
        relatedEntityType: 'rental',
        relatedEntityId: rental.id,
        targetUrl: `/rentals/${rental.id}`,
      })),
      skipDuplicates: true,
    });
    result.unansweredQuestion = true;
  }

  // 3. Incident signalé → notification
  if (analysis.incidentReported && admins.length > 0) {
    await db.notification.createMany({
      data: admins.map(a => ({
        userId: a.id,
        type: 'incident_reported',
        title: `⚠️ Incident signalé — ${rental.driverName}`,
        body: `${rental.vehicle.make} ${rental.vehicle.model} (${rental.vehicle.licensePlate})`,
        relatedEntityType: 'rental',
        relatedEntityId: rental.id,
        targetUrl: `/rentals/${rental.id}`,
      })),
      skipDuplicates: true,
    });
    result.incidentReported = true;
  }

  return result;
}
