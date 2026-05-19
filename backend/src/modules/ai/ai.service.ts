import Anthropic from '@anthropic-ai/sdk';

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
