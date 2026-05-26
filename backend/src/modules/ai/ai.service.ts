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

// ─── 4.5 — Optimisation tarifaire IA ────────────────────────────────────────

export interface PricingSuggestion {
  vehicleId: string;
  licensePlate: string;
  make: string;
  model: string;
  occupancyRate: number;
  avgDailyRevenue: number;
  suggestion: string;
}

export async function getPricingSuggestions(db: PrismaClient): Promise<PricingSuggestion[]> {
  const now = new Date();
  const from = new Date(now.getTime() - 30 * 86_400_000);

  const vehicles = await db.vehicle.findMany({
    where: { isActive: true },
    select: { id: true, make: true, model: true, licensePlate: true },
  });

  const suggestions: PricingSuggestion[] = [];

  for (const vehicle of vehicles) {
    const rentals = await db.rental.findMany({
      where: { vehicleId: vehicle.id, startAt: { gte: from }, status: { in: ['completed', 'active'] } },
      select: { startAt: true, endAt: true, grossRevenue: true },
    });

    const bookedDays = rentals.reduce((s, r) => {
      const start = new Date(r.startAt) < from ? from : new Date(r.startAt);
      const end = new Date(r.endAt) > now ? now : new Date(r.endAt);
      return s + Math.max(0, (end.getTime() - start.getTime()) / 86_400_000);
    }, 0);

    const occupancyRate = Math.round((bookedDays / 30) * 100);
    if (occupancyRate >= 40) continue;

    const totalRevenue = rentals.reduce((s, r) => s + (r.grossRevenue ?? 0), 0);
    const avgDailyRevenue = bookedDays > 0 ? Math.round((totalRevenue / bookedDays) * 100) / 100 : 0;

    try {
      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        system: 'Tu es un expert en optimisation tarifaire pour la location de voitures. Réponds en 2 lignes maximum en français.',
        messages: [{
          role: 'user',
          content: `Véhicule : ${vehicle.make} ${vehicle.model} (${vehicle.licensePlate})\nTaux d'occupation : ${occupancyRate}% sur 30 jours\nPrix moyen actuel : ${avgDailyRevenue}€/jour\nSugère un ajustement tarifaire et justifie en 2 lignes.`,
        }],
      });
      const suggestion = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
      suggestions.push({ vehicleId: vehicle.id, licensePlate: vehicle.licensePlate, make: vehicle.make, model: vehicle.model, occupancyRate, avgDailyRevenue, suggestion });
    } catch {
      suggestions.push({ vehicleId: vehicle.id, licensePlate: vehicle.licensePlate, make: vehicle.make, model: vehicle.model, occupancyRate, avgDailyRevenue, suggestion: 'Suggestion indisponible' });
    }
  }

  return suggestions;
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
