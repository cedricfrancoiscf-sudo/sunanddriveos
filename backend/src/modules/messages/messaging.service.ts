import Anthropic from '@anthropic-ai/sdk';
import { Resend } from 'resend';
import type { PrismaClient } from '../../generated/tenant';
import type { GetaroundClient } from '../getaround-sync/getaround-sync.service';
import { buildCarSeatsPromptBlock, CAR_SEAT_PROMPT_CONSIGNES, ESCALATION_BAN_RULE } from '../car-seats/car-seats.service';

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function getResend(): Resend {
  return new Resend(process.env.RESEND_API_KEY);
}

const FROM_ADDR = process.env.RESEND_FROM ?? 'noreply@sunanddrive.com';

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
  details: {
    childWeightKg?: number | null;
    carSeatOutcome?: 'confirmed' | 'unavailable' | 'weight_needed' | null;
    question?: string | null;
    incidentType?: string | null;
  };
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

// ─── Guard : la location doit être active ou réservée ─────────────────────────
// Jamais sur 'completed' ou 'cancelled' — aucune action automatique.
export function isRentalActionable(rental: { status: string }): boolean {
  return rental.status === 'active' || rental.status === 'booked';
}

const MESSAGE_FRESHNESS_MS = 24 * 3_600_000; // 24h

const URGENCY_PATTERNS = [
  /\b(panne|accident|urgence|danger|bless[eé]|immobilis[eé]|ne d[eé]marre pas)\b/i,
];

function detectEmergency(content: string): boolean {
  return URGENCY_PATTERNS.some(p => p.test(content));
}

function fmtBool(v: boolean | null | undefined): string {
  return v == null ? 'Non renseigné' : v ? 'Oui' : 'Non';
}

function buildEquipBlock(equip: {
  gpsIntegre: boolean | null;
  androidAutoCarplay: boolean | null;
  climatisation: boolean | null;
  regulateurLimiteur: boolean | null;
  radarRecul: boolean | null;
  cameraRecul: boolean | null;
  typeBoite: string | null;
  bluetoothAudio: boolean | null;
  particularites: string | null;
  alertesConnuesNonCritiques: string | null;
  pickupInstructions: string | null;
  returnInstructions: string | null;
}): string {
  const lines = [
    'Équipements du véhicule :',
    `GPS : ${fmtBool(equip.gpsIntegre)} | Android Auto/CarPlay : ${fmtBool(equip.androidAutoCarplay)} | Climatisation : ${fmtBool(equip.climatisation)}`,
    `Bluetooth : ${fmtBool(equip.bluetoothAudio)} | Radar recul : ${fmtBool(equip.radarRecul)} | Caméra recul : ${fmtBool(equip.cameraRecul)}`,
    `Boîte : ${equip.typeBoite ?? 'Non renseigné'} | Régulateur/limiteur : ${fmtBool(equip.regulateurLimiteur)}`,
  ];
  if (equip.particularites) lines.push(`Particularités : ${equip.particularites}`);
  if (equip.alertesConnuesNonCritiques) lines.push(`Alertes connues : ${equip.alertesConnuesNonCritiques}`);
  if (equip.pickupInstructions) lines.push(`Instructions remise : ${equip.pickupInstructions.slice(0, 300)}`);
  if (equip.returnInstructions) lines.push(`Instructions retour : ${equip.returnInstructions.slice(0, 300)}`);
  lines.push('RÈGLE : Pour tout équipement "Non renseigné", NE JAMAIS affirmer qu\'il est présent ou absent.');
  return '\n' + lines.join('\n');
}

export async function analyzeAndProcessMessage(
  message: { id: string; content: string; sentAt?: Date | null },
  rental: RentalForMessaging,
  db: PrismaClient,
  ga: GetaroundClient,
): Promise<void> {
  console.log(`[Messaging] IA analyse message ${message.id} — rental ${rental.id} (${rental.driverName})`);

  // ── Guard 1 : statut location — JAMAIS sur completed/cancelled ───────────
  if (!isRentalActionable(rental)) {
    console.log(`[Messaging] Ignoré — location ${rental.status} non actionnable (rental ${rental.id})`);
    return;
  }

  // ── Guard 2 : fraîcheur du message — 24h max, basée sur sentAt (envoi
  // Getaround) et non createdAt (ingestion en base) — un re-fetch de la sync
  // ne doit jamais générer de brouillon sur un message ancien.
  if (message.sentAt && Date.now() - message.sentAt.getTime() > MESSAGE_FRESHNESS_MS) {
    console.log(`[Messaging] Ignoré — message trop ancien (message ${message.id}, envoyé le ${message.sentAt.toISOString()})`);
    return;
  }

  // Détection d'urgence avant toute analyse IA
  if (detectEmergency(message.content)) {
    console.log(`[Messaging] 🚨 Urgence détectée — message ${message.id} rental ${rental.id}`);

    const settings = await db.companySettings.findFirst({
      select: { aiTone: true, aiName: true, senderName: true, alertEmails: true },
    });
    const tone = settings?.aiTone === 'tutoiement' ? 'tutoiement' : 'vouvoiement';
    const assistantName = settings?.aiName ?? settings?.senderName ?? 'notre équipe';

    const civility = tone === 'tutoiement' ? 'Nous sommes désolés pour ce désagrément.' : 'Nous sommes désolés pour ce désagrément.';
    const emergencyReply = `${civility} Pour une prise en charge rapide en cas de panne ou d'accident, merci de contacter directement l'assistance Getaround depuis votre page de location. — ${assistantName}`;

    // Idempotence : ne réclame le message que s'il n'a pas déjà été traité par un
    // autre passage (cron horaire / 15 min / 30 min / rebalayage 7h peuvent tous
    // voir le même message inbound). Sans ce verrou, l'urgence était renvoyée au
    // locataire à chaque nouveau passage tant que le message restait "frais".
    const emergencyClaim = await db.message.updateMany({
      where: { id: message.id, aiSuggestion: null },
      data: { aiAnalysis: { isEmergency: true }, aiSuggestion: emergencyReply },
    });
    if (emergencyClaim.count === 0) {
      console.log(`[Messaging] Urgence déjà traitée — message ${message.id} ignoré (idempotence)`);
      return;
    }

    // Envoi immédiat du message de redirection (status='sent', bypass approval)
    if (rental.getaroundId) {
      try {
        await ga.sendMessage(parseInt(rental.getaroundId, 10), emergencyReply);
        await db.message.create({
          data: {
            rentalId: rental.id,
            direction: 'outbound',
            content: emergencyReply,
            sentAt: new Date(),
            status: 'sent',
            aiSuggestion: emergencyReply,
            origin: 'ai_approved',
          },
        });
        console.log(`[Messaging] ✅ Message urgence envoyé rental ${rental.id}`);
      } catch (e) {
        console.error('[Messaging] Erreur envoi urgence:', e);
      }
    }

    // Alerte aux admins
    const admins = await db.user.findMany({
      where: { isActive: true, OR: [{ role: 'admin' }, { roles: { has: 'admin' } }] },
      select: { id: true, email: true },
    });
    if (admins.length > 0) {
      await db.notification.createMany({
        data: admins.map(a => ({
          userId: a.id,
          type: 'urgence_locataire',
          title: `🚨 Urgence — ${rental.driverName}`,
          body: message.content.slice(0, 120),
          relatedEntityType: 'rental',
          relatedEntityId: rental.id,
          targetUrl: `/rentals/${rental.id}`,
        })),
        skipDuplicates: true,
      });
    }

    // Email si alertEmails configurés
    const alertEmails = settings?.alertEmails ?? [];
    if (alertEmails.length > 0 && process.env.RESEND_API_KEY) {
      try {
        await getResend().emails.send({
          from: `${assistantName} <${FROM_ADDR}>`,
          to: alertEmails,
          subject: `🚨 Urgence locataire — ${rental.driverName} (${rental.vehicle.licensePlate})`,
          html: `<p><strong>Urgence signalée</strong> par <strong>${rental.driverName}</strong>.</p>
<p>Véhicule&nbsp;: ${rental.vehicle.make} ${rental.vehicle.model} (${rental.vehicle.licensePlate})</p>
<p>Message&nbsp;: ${message.content}</p>
<p><a href="https://appli.sunanddrive.com/rentals/${rental.id}">Voir la conversation</a></p>`,
        });
      } catch (e) {
        console.error('[Messaging] Erreur email urgence:', e);
      }
    }

    return;
  }

  const settings = await db.companySettings.findFirst({
    select: {
      aiModeCarSeat: true, aiModeIncident: true, aiModeGeneral: true,
      aiTone: true, aiName: true, senderName: true, getaroundRules: true,
    },
  });
  if (!settings) return;

  const tone = settings.aiTone === 'tutoiement' ? 'tutoiement' : 'vouvoiement';
  const assistantName = settings.aiName ?? settings.senderName ?? 'notre service';
  const companyName = settings.senderName ?? '';

  // Charger les équipements Fiche IA du véhicule pour enrichir le prompt de suggestion
  const vehicleEquip = await db.vehicle.findUnique({
    where: { id: rental.vehicleId },
    select: {
      gpsIntegre: true, androidAutoCarplay: true, climatisation: true,
      regulateurLimiteur: true, radarRecul: true, cameraRecul: true,
      typeBoite: true, bluetoothAudio: true, particularites: true,
      alertesConnuesNonCritiques: true, pickupInstructions: true, returnInstructions: true,
    },
  });

  // BLOC 2 — contexte fil complet (ordre chronologique, tous messages récents)
  const recentThread = await db.message.findMany({
    where: { rentalId: rental.id },
    orderBy: { createdAt: 'asc' },
    take: 20,
    select: { direction: true, content: true, status: true, createdAt: true },
  });
  // Construire le fil pour le prompt : locataire / nous (envoyé) / messages système écartés
  const threadLines = recentThread
    .map(m => {
      if (m.direction === 'inbound') return `[LOCATAIRE] ${m.content}`;
      // Inclure seulement les outbound réellement envoyés pour que l'IA sache ce qui a été répondu
      if (m.direction === 'outbound' && m.status === 'sent') return `[NOUS - réponse envoyée] ${m.content}`;
      return null;
    })
    .filter((l): l is string => l !== null);
  const threadContext = threadLines.length > 1
    ? `\nHistorique de la conversation :\n${threadLines.slice(0, -1).join('\n')}\n\nDernier message du locataire : "${message.content}"`
    : `Message du locataire : "${message.content}"`;

  // Règles plateforme Getaround (identiques pour toute la flotte) — priorité 1,
  // avant les sièges auto (priorité 2), la fiche véhicule (priorité 3) et
  // l'historique du fil (priorité 4).
  const getaroundRulesBlock = settings.getaroundRules
    ? `\n\n=== RÈGLES GETAROUND (plateforme, priorité 1 — valables pour toute la flotte) ===\n${settings.getaroundRules}\n=== FIN DES RÈGLES GETAROUND ===\n`
    : '';

  // Liste des sièges auto — injectée systématiquement pour que l'IA puisse
  // répondre directement à une demande de siège au lieu d'esquiver (elle ne
  // recevait auparavant NI cette liste NI les règles Getaround).
  const carSeats = await db.carSeat.findMany({
    where: { isActive: true },
    select: { name: true, minWeightKg: true, maxWeightKg: true, availableStock: true },
    orderBy: { minWeightKg: 'asc' },
  });
  const carSeatsBlock = buildCarSeatsPromptBlock(carSeats);

  // 1. Analyse Claude
  let analysis: ProactiveAnalysis;
  try {
    const resp = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      system: `Tu es ${assistantName}, assistant d'un opérateur de location de voitures sur Getaround.
Tu analyses les messages de locataires et génères une réponse courte et professionnelle.
Tiens compte de TOUT l'historique de la conversation pour contextualiser ta réponse.

Hiérarchie des sources, dans cet ordre :
1) Règles Getaround (plateforme, ci-dessous) — valables pour toute la flotte
2) Sièges auto disponibles (ci-dessous, si la demande concerne un siège auto)
3) Fiche du véhicule concerné (équipements, instructions spécifiques à cette voiture)
4) Historique du fil de conversation
${getaroundRulesBlock}${carSeatsBlock}
Réponds en JSON uniquement, sans markdown :
{"type":"car_seat"|"remise"|"incident"|"general"|"remerciement","urgent":boolean,"details":{"childWeightKg":number|null,"carSeatOutcome":"confirmed"|"unavailable"|"weight_needed"|null,"question":string|null,"incidentType":string|null},"suggestedReply":string}

CONSIGNES SIÈGE AUTO (si type="car_seat") — champ details.carSeatOutcome à remplir en conséquence ("weight_needed"|"confirmed"|"unavailable") :
${CAR_SEAT_PROMPT_CONSIGNES}

Règles STRICTES pour suggestedReply :
- En ${tone}, signée ${assistantName}
- Maximum 4 lignes, 300 caractères
- AUCUN markdown (pas de **, #, *, _)
- Maximum 1 emoji, seulement si naturel
- Langue : français uniquement
- Style : direct, chaleureux, professionnel
- Pas de formules cérémonieuses ("excellent séjour", "à votre entière disposition")
- Se concentrer sur l'essentiel : répondre à la question ou confirmer l'information demandée
- Si la réponse figure dans les règles Getaround ci-dessus, RÉPONDS-Y directement — ne jamais esquiver une question dont la réponse est connue et stable
- Ne jamais inventer une information absente des règles Getaround, de la liste des sièges, de la fiche véhicule ou de l'historique
- ${ESCALATION_BAN_RULE}`,
      messages: [{
        role: 'user',
        content: `${threadContext}
Véhicule : ${rental.vehicle.make} ${rental.vehicle.model} (${rental.vehicle.licensePlate})
Lieu : ${rental.vehicle.deliveryPointName ?? rental.vehicle.parkingZone ?? 'Non défini'}
Début location : ${rental.startAt.toLocaleDateString('fr-FR')}
Locataire : ${rental.driverName}${vehicleEquip ? buildEquipBlock(vehicleEquip) : ''}`,
      }],
    });
    const text = resp.content[0]?.type === 'text' ? resp.content[0].text : '{}';
    analysis = JSON.parse(cleanClaudeJson(text)) as ProactiveAnalysis;
  } catch (error) {
    console.error('[Messaging] Erreur Claude API:', error);
    return;
  }

  // Idempotence : réclamer le message ATOMIQUEMENT dès qu'on a une réponse,
  // avant toute décision d'action (envoi/brouillon/notification). Un même
  // message inbound peut être vu par le cron horaire, le cron 15 min, le cron
  // proactif 30 min et le rebalayage 7h — seul le premier qui gagne la course
  // continue ; les autres s'arrêtent ici, sans jamais agir deux fois.
  const claim = await db.message.updateMany({
    where: { id: message.id, aiSuggestion: null },
    data: { aiSuggestion: analysis.suggestedReply },
  });
  if (claim.count === 0) {
    console.log(`[Messaging] Message ${message.id} déjà traité entre-temps — ignoré (idempotence)`);
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
    mode = settings.aiModeIncident ?? 'manual';
  } else {
    mode = settings.aiModeGeneral ?? 'manual';
  }

  // 4. Siège auto : suggestedReply vient déjà de Claude (informé de la liste des
  // sièges ci-dessus) — plus de matching/décrément déterministe ici. On trace
  // seulement la demande (une fois par location) et on alerte l'équipe si un
  // siège a été confirmé ou si aucun n'est disponible, pour l'action physique.
  const suggestedReply = analysis.suggestedReply;
  if (analysis.type === 'car_seat') {
    // Ignorer les demandes de siège sur locations terminées ou passées
    if (!['booked', 'active'].includes(rental.status) || rental.endAt <= new Date()) {
      console.log(`[Messaging] Demande siège ignorée — location passée (rental ${rental.id}, status=${rental.status})`);
      return;
    }
    const existing = await db.carSeatRequest.findFirst({ where: { rentalId: rental.id } });
    if (!existing) {
      await db.carSeatRequest.create({
        data: {
          vehicleId: rental.vehicleId,
          rentalId: rental.id,
          childWeightKg: analysis.details.childWeightKg ?? undefined,
        },
      });
    } else if (existing.childWeightKg == null && analysis.details.childWeightKg != null) {
      // Poids donné dans un message de suivi (pas le premier) — compléter la trace
      await db.carSeatRequest.update({ where: { id: existing.id }, data: { childWeightKg: analysis.details.childWeightKg } });
    }

    const outcome = analysis.details.carSeatOutcome;
    if (outcome === 'confirmed' || outcome === 'unavailable') {
      // Vérification serveur avant d'alerter l'équipe : ne jamais confirmer sur
      // la seule foi du JSON de Claude si aucun siège n'est réellement disponible.
      const reallyConfirmed = outcome === 'confirmed' && carSeats.some(s => s.availableStock > 0);
      const staff = await db.user.findMany({
        where: { role: { in: ['admin', 'carkeeper'] }, isActive: true },
        select: { email: true },
      });
      const emails = staff.map(u => u.email).filter(Boolean);
      void sendCarSeatEmail(emails, rental, assistantName, reallyConfirmed).catch(e =>
        console.error('[Messaging] Erreur email siège auto:', e),
      );
      console.log(`[Messaging] Siège auto — rental ${rental.id} : ${outcome} (vérifié=${reallyConfirmed})`);
    }
  }

  // aiSuggestion déjà sauvegardée sur le message inbound source par le claim
  // d'idempotence ci-dessus — pas de deuxième écriture nécessaire ici.

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
            origin: 'ai_approved',
          },
        });
        console.log(`[Messaging] Auto-envoi message rental ${rental.id}`);
      }
    } catch (e) { console.error('[Messaging] Erreur envoi auto:', e); }
    return;
  }

  if (mode === 'approval') {
    // BLOC 2 — régénération : annuler tout brouillon pending existant (non approuvé/envoyé)
    const existingPending = await db.message.findFirst({
      where: { rentalId: rental.id, direction: 'outbound', status: 'pending_approval' },
      select: { id: true },
    });
    if (existingPending) {
      await db.message.update({
        where: { id: existingPending.id },
        data: { status: 'cancelled', cancelledAt: new Date() },
      });
      console.log(`[Messaging] Brouillon périmé remplacé — ${existingPending.id} → nouveau contexte`);
    }

    await db.message.create({
      data: {
        rentalId: rental.id,
        direction: 'outbound',
        content: suggestedReply,
        status: 'pending_approval',
        aiSuggestion: suggestedReply,
        origin: 'ai_approved',
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

  // 1. Siège auto demandé non traité → rattraper (trace uniquement, ne pilote
  // plus le stock — l'équipe vérifie la disponibilité et répond manuellement)
  if (analysis.carSeatRequested && !analysis.carSeatHandled) {
    const existing = await db.carSeatRequest.findFirst({ where: { rentalId: rental.id } });
    if (!existing) {
      await db.carSeatRequest.create({
        data: { vehicleId: rental.vehicleId, rentalId: rental.id },
      });
      const [staff, anyAvailable] = await Promise.all([
        db.user.findMany({
          where: { isActive: true, OR: [{ role: { in: ['admin', 'carkeeper'] } }, { roles: { hasSome: ['admin', 'carkeeper'] } }] },
          select: { email: true },
        }),
        db.carSeat.count({ where: { isActive: true, availableStock: { gt: 0 } } }),
      ]);
      const emails = staff.map(u => u.email).filter(Boolean);
      // Pas de poids/plage connue ici (ConversationAnalysis ne les extrait pas) —
      // on ne peut confirmer qu'un siège EXISTE en stock, pas qu'il est adapté.
      void sendCarSeatEmail(emails, rental, assistantName, anyAvailable > 0).catch(e =>
        console.error('[MorningReview] Erreur email siège:', e),
      );
      console.log(`[MorningReview] Demande siège rattrapée — rentalId ${rental.id} (stock dispo=${anyAvailable > 0})`);
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
