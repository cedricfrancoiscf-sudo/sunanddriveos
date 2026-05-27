import Anthropic from '@anthropic-ai/sdk';
import type { PrismaClient } from '../../generated/tenant';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface MessageAnalysis {
  isCarSeatRequest: boolean;
  isIncidentReport: boolean;
  isDissatisfaction: boolean;
  isUrgent: boolean;
  intent: string;        // résumé court de l'intention
  sentiment: 'positive' | 'neutral' | 'negative';
}

export interface RentalContext {
  driverName: string;
  vehicleMake: string;
  vehicleModel: string;
  licensePlate: string;
  startDate: string;
  endDate: string;
}

export async function analyzeMessage(content: string): Promise<MessageAnalysis> {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    system:
      'Tu es un assistant qui analyse les messages de locataires pour un service de location de voitures (Getaround). ' +
      'Réponds uniquement avec un objet JSON valide, sans markdown ni explication.',
    messages: [
      {
        role: 'user',
        content: `Analyse ce message d'un locataire et retourne un JSON avec ces champs :
- isCarSeatRequest (boolean) : le locataire demande un siège auto enfant
- isIncidentReport (boolean) : signalement de sinistre, accident, dommage, vol
- isDissatisfaction (boolean) : insatisfaction, plainte, mécontentement
- isUrgent (boolean) : situation urgente nécessitant réponse immédiate
- intent (string, max 80 chars) : résumé court de l'intention en français
- sentiment ("positive" | "neutral" | "negative")

Message : "${content}"`,
      },
    ],
  });

  const text = response.content[0]?.type === 'text' ? response.content[0].text : '{}';
  try {
    return JSON.parse(text) as MessageAnalysis;
  } catch {
    return {
      isCarSeatRequest: false,
      isIncidentReport: false,
      isDissatisfaction: false,
      isUrgent: false,
      intent: 'Analyse indisponible',
      sentiment: 'neutral',
    };
  }
}

export interface CarSeatInfo {
  name: string;
  minWeightKg: number;
  maxWeightKg: number;
  availableStock: number;
}

export async function suggestCarSeatReply(
  context: RentalContext,
  childWeightKg: number | null,
  seats: CarSeatInfo[],
  tone: 'vouvoiement' | 'tutoiement' = 'vouvoiement',
): Promise<string> {
  let prompt: string;

  if (childWeightKg === null) {
    prompt = `Un locataire (${context.driverName}) loue le véhicule ${context.vehicleMake} ${context.vehicleModel} du ${context.startDate} au ${context.endDate} et demande un siège auto pour son enfant. Rédige un message lui demandant le poids de l'enfant afin de lui proposer le siège le plus adapté. Sois chaleureux et concis.`;
  } else {
    const matching = seats.filter(s => childWeightKg >= s.minWeightKg && childWeightKg <= s.maxWeightKg);
    const available = matching.filter(s => s.availableStock > 0);

    if (available.length > 0) {
      const seat = available[0]!;
      prompt = `Un locataire (${context.driverName}) demande un siège auto pour un enfant de ${childWeightKg} kg. Nous avons en stock : "${seat.name}" (convient de ${seat.minWeightKg} à ${seat.maxWeightKg} kg). Rédige une confirmation chaleureuse lui annonçant que ce siège est disponible et sera préparé pour sa location du ${context.startDate} au ${context.endDate}.`;
    } else if (matching.length > 0) {
      const firstMatch = matching[0]!;
      prompt = `Un locataire (${context.driverName}) demande un siège auto pour un enfant de ${childWeightKg} kg. Le siège adapté ("${firstMatch.name}", ${firstMatch.minWeightKg}–${firstMatch.maxWeightKg} kg) est malheureusement en rupture de stock. Rédige un message de refus poli et professionnel, en présentant des excuses sincères pour cette indisponibilité.`;
    } else {
      prompt = `Un locataire (${context.driverName}) demande un siège auto pour un enfant de ${childWeightKg} kg. Aucun de nos sièges ne correspond à ce poids. Rédige un message poli expliquant que notre équipement actuel ne peut pas répondre à cette demande, en nous excusant.`;
    }
  }

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    system: `Tu rédiges des messages professionnels et chaleureux pour Sun and Drive, service de location de voitures. Utilise le ${tone}. Réponds directement avec le texte du message, sans introduction ni titre.`,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
}

// ─── 4.3 — Prévision trésorerie 30 jours ────────────────────────────────────

export interface CashflowWeek {
  week: string;           // "2026-W22" (ISO 8601)
  weekStart: string;      // ISO date du lundi
  expectedRevenue: number;
  rentalCount: number;
}

function mondayToISOWeek(monday: Date): string {
  // Thursday determines ISO week year
  const thursday = new Date(monday);
  thursday.setDate(monday.getDate() + 3);
  const year = thursday.getFullYear();
  const jan4 = new Date(year, 0, 4);
  const startOfFirstWeek = new Date(jan4);
  startOfFirstWeek.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const weekNum = Math.floor((monday.getTime() - startOfFirstWeek.getTime()) / (7 * 86_400_000)) + 1;
  return `${year}-W${String(weekNum).padStart(2, '0')}`;
}

export async function forecastCashflow(db: PrismaClient): Promise<CashflowWeek[]> {
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 86_400_000);

  const rentals = await db.rental.findMany({
    where: { status: 'booked', startAt: { gte: now, lte: in30 } },
    select: { startAt: true, grossRevenue: true },
  });

  const weeks: Map<string, CashflowWeek> = new Map();

  for (const r of rentals) {
    const d = new Date(r.startAt);
    // Calculer le lundi de la semaine
    const day = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    monday.setHours(0, 0, 0, 0);
    const key = monday.toISOString().slice(0, 10);

    const existing = weeks.get(key);
    if (existing) {
      existing.rentalCount++;
      existing.expectedRevenue += r.grossRevenue ?? 0;
    } else {
      weeks.set(key, {
        week: mondayToISOWeek(monday),
        weekStart: key,
        expectedRevenue: r.grossRevenue ?? 0,
        rentalCount: 1,
      });
    }
  }

  return Array.from(weeks.values()).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

// ─── 4.4 — Détection anomalie kilométrique ───────────────────────────────────

export interface MileageAnomaly {
  rentalId: string;
  driverName: string;
  vehicleLicensePlate: string;
  kmDriven: number;
  durationDays: number;
  threshold: number;
  startAt: string;
  endAt: string;
}

export async function detectMileageAnomalies(db: PrismaClient): Promise<MileageAnomaly[]> {
  const rentals = await db.rental.findMany({
    where: { status: 'completed', kmDriven: { gt: 0 } },
    select: {
      id: true, driverName: true, startAt: true, endAt: true, kmDriven: true,
      vehicle: { select: { licensePlate: true } },
    },
    orderBy: { endAt: 'desc' },
    take: 500,
  });

  const anomalies: MileageAnomaly[] = [];

  for (const r of rentals) {
    if (!r.kmDriven) continue;
    const durationMs = new Date(r.endAt).getTime() - new Date(r.startAt).getTime();
    const durationDays = Math.max(1, Math.ceil(durationMs / 86_400_000));
    const threshold = durationDays * 150 * 2;

    if (r.kmDriven > threshold) {
      anomalies.push({
        rentalId: r.id,
        driverName: r.driverName,
        vehicleLicensePlate: r.vehicle.licensePlate,
        kmDriven: r.kmDriven,
        durationDays,
        threshold,
        startAt: r.startAt.toISOString(),
        endAt: r.endAt.toISOString(),
      });
    }
  }

  return anomalies;
}

// Crée des notifications pour les nouvelles anomalies détectées
export async function notifyMileageAnomalies(db: PrismaClient): Promise<void> {
  const [anomalies, admins] = await Promise.all([
    detectMileageAnomalies(db),
    db.user.findMany({ where: { role: 'admin', isActive: true }, select: { id: true } }),
  ]);

  for (const anomaly of anomalies) {
    for (const admin of admins) {
      const existing = await db.notification.findFirst({
        where: { userId: admin.id, type: 'mileage_anomaly', relatedEntityId: anomaly.rentalId },
      });
      if (existing) continue;
      await db.notification.create({
        data: {
          userId: admin.id,
          type: 'mileage_anomaly',
          title: `Anomalie km — ${anomaly.vehicleLicensePlate}`,
          body: `${anomaly.kmDriven} km en ${anomaly.durationDays}j (plafond : ${anomaly.threshold} km) · ${anomaly.driverName}`,
          relatedEntityType: 'rental',
          relatedEntityId: anomaly.rentalId,
        },
      });
    }
  }
}

// ─── 4.5 — Alertes qualité de service ───────────────────────────────────────
// Note : Getaround gère la tarification dynamiquement — aucune suggestion de prix ici.

export interface QualityAlert {
  vehicleId: string;
  licensePlate: string;
  make: string;
  model: string;
  type: 'rating_decline' | 'recurring_keywords' | 'inactive_vehicle';
  message: string;
  rating?: number;
  previousRating?: number;
}

export async function getQualityAlerts(db: PrismaClient): Promise<QualityAlert[]> {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

  const vehicles = await db.vehicle.findMany({
    where: { isActive: true },
    select: {
      id: true, make: true, model: true, licensePlate: true,
      ratings: {
        where: { period: { in: [currentMonth, prevMonth] } },
        orderBy: { period: 'desc' },
      },
    },
  });

  const alerts: QualityAlert[] = [];

  for (const vehicle of vehicles) {
    const cur = vehicle.ratings.find(r => r.period === currentMonth);
    const prev = vehicle.ratings.find(r => r.period === prevMonth);

    if (cur && prev && cur.rating < prev.rating) {
      alerts.push({
        vehicleId: vehicle.id, licensePlate: vehicle.licensePlate, make: vehicle.make, model: vehicle.model,
        type: 'rating_decline',
        message: `Note en baisse : ${prev.rating}/5 → ${cur.rating}/5`,
        rating: cur.rating, previousRating: prev.rating,
      });
    }

    if (cur && cur.keywords.length > 0 && cur.rating < 4.0) {
      const flagged = cur.keywords.filter(k => ['propreté', 'état'].includes(k.toLowerCase()));
      if (flagged.length > 0) {
        alerts.push({
          vehicleId: vehicle.id, licensePlate: vehicle.licensePlate, make: vehicle.make, model: vehicle.model,
          type: 'recurring_keywords',
          message: `Avis mentionnant : ${flagged.join(', ')} (note ${cur.rating}/5). Inspection recommandée.`,
          rating: cur.rating,
        });
      }
    }
  }

  const since30 = new Date(now.getTime() - 30 * 86_400_000);
  const inactive = await db.vehicle.findMany({
    where: { isActive: true, rentals: { none: { startAt: { gte: since30 } } } },
    select: { id: true, make: true, model: true, licensePlate: true },
  });

  for (const v of inactive) {
    if (!alerts.some(a => a.vehicleId === v.id)) {
      alerts.push({
        vehicleId: v.id, licensePlate: v.licensePlate, make: v.make, model: v.model,
        type: 'inactive_vehicle',
        message: 'Aucune location depuis 30 jours. Améliorez les photos et la description.',
      });
    }
  }

  return alerts;
}

// ─── Briefing matinal avec contexte qualité ───────────────────────────────────

export interface MorningBriefingContext {
  companyName: string;
  date: string;
  departures: Array<{ driverName: string; vehicle: string }>;
  returns: Array<{ driverName: string; vehicle: string }>;
  vehicleRatings: Array<{ make: string; model: string; licensePlate: string; rating: number; previousRating: number | null; keywords: string[] }>;
  unansweredCount: number;
}

export async function generateMorningBriefing(context: MorningBriefingContext): Promise<string> {
  const ratingsText = context.vehicleRatings.length > 0
    ? context.vehicleRatings.map(vr => {
        const trend = vr.previousRating !== null
          ? ` (${vr.previousRating > vr.rating ? '↘' : vr.previousRating < vr.rating ? '↗' : '→'} vs ${vr.previousRating}/5)`
          : '';
        const kw = vr.keywords.length > 0 ? ` — avis : ${vr.keywords.join(', ')}` : '';
        return `- ${vr.make} ${vr.model} (${vr.licensePlate}) : ${vr.rating}/5${trend}${kw}`;
      }).join('\n')
    : 'Aucune note Getaround enregistrée ce mois.';

  const prompt = `Génère un briefing matinal concis pour ${context.companyName} — ${context.date}.

Départs : ${context.departures.map(d => `${d.driverName} (${d.vehicle})`).join(', ') || 'aucun'}
Retours : ${context.returns.map(r => `${r.driverName} (${r.vehicle})`).join(', ') || 'aucun'}
Messages sans réponse depuis +12h : ${context.unansweredCount}

Notes Getaround :
${ratingsText}

Règles strictes :
- Ne jamais suggérer de modifier les prix. Getaround gère la tarification automatiquement.
- Suggestions uniquement sur : propreté, réactivité, photos, description, entretien.
- 5 à 8 lignes maximum, direct et actionnable.`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: 'Tu rédiges des briefings opérationnels pour des gestionnaires de flotte Getaround. Réponds directement sans introduction.',
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
}

export async function suggestReply(
  incomingMessage: string,
  context: RentalContext,
  tone: 'vouvoiement' | 'tutoiement' = 'vouvoiement',
  previousMessages?: Array<{ direction: string; content: string }>,
): Promise<string> {
  const historyBlock =
    previousMessages && previousMessages.length > 0
      ? '\n\nHistorique de la conversation :\n' +
        previousMessages
          .slice(-6)
          .map((m) => `[${m.direction === 'inbound' ? 'Locataire' : 'Nous'}] : ${m.content}`)
          .join('\n')
      : '';

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: `Tu es un assistant pour Sun and Drive, service de location de voitures partagées.
Tu rédiges des réponses professionnelles, chaleureuses et concises en français.
Utilise le ${tone} avec le locataire.
Ne jamais suggérer de modifier les prix. Getaround gère la tarification automatiquement.
Réponds directement avec le texte du message, sans introduction ni explication.`,
    messages: [
      {
        role: 'user',
        content: `Rédige une réponse au message suivant d'un locataire.

Contexte de la location :
- Locataire : ${context.driverName}
- Véhicule : ${context.vehicleMake} ${context.vehicleModel} (${context.licensePlate})
- Du ${context.startDate} au ${context.endDate}
${historyBlock}

Message du locataire : "${incomingMessage}"

Réponse (directement le texte, sans formule d'appel) :`,
      },
    ],
  });

  return response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
}
