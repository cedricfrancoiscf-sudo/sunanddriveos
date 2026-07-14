// Niveau 1 (14/07) : plus de calcul cumulatif ni de comptage de CarSeatRequest.
// availableStock est une pure fonction de l'état du siège — recalculée à chaque
// écriture, jamais incrémentée/décrémentée. Ne peut plus dériver de la réalité.
export function computeAvailableStock(seat: { totalStock: number; outOfService: number; isAvailable: boolean }): number {
  if (!seat.isAvailable) return 0;
  return Math.max(0, seat.totalStock - seat.outOfService);
}

// Bloc "liste des sièges" injecté dans les prompts IA (messaging.service.ts ET
// ai.service.ts/suggestReply) — une seule implémentation pour que les deux
// pipelines ne puissent jamais afficher une disponibilité différente pour le
// même siège (c'est exactement ce type de divergence qui a causé l'esquive
// sur la demande de Karim : un chemin avait la liste, l'autre non).
export function buildCarSeatsPromptBlock(seats: Array<{ name: string; minWeightKg: number; maxWeightKg: number; availableStock: number }>): string {
  if (seats.length === 0) return '';
  const lines = seats.map(s => `- ${s.name} : ${s.minWeightKg}-${s.maxWeightKg} kg — ${s.availableStock > 0 ? 'DISPONIBLE' : 'PRIS/INDISPONIBLE'}`);
  return `\n\n=== SIÈGES AUTO (liste exhaustive — ne jamais inventer un siège absent d'ici) ===\n${lines.join('\n')}\n=== FIN DES SIÈGES AUTO ===\n`;
}

// Consignes de traitement d'une demande de siège auto — partagées entre les
// deux pipelines IA pour éviter toute divergence de comportement.
export const CAR_SEAT_PROMPT_CONSIGNES = `Poids de l'enfant inconnu (ni dans ce message ni dans l'historique) → demande UNIQUEMENT le poids, une seule question.
Poids connu → déduis la plage adaptée parmi les sièges listés ci-dessus et vérifie s'il existe un siège DISPONIBLE couvrant ce poids.
  - Siège adapté DISPONIBLE → confirme la mise à disposition en nommant le siège.
  - Aucun siège adapté disponible → le dire honnêtement, sans promettre de délai ni de solution.
Ne jamais inventer un siège absent de la liste fournie.`;

// Interdiction d'esquive vague — partagée entre les deux pipelines IA. Une
// interdiction de PHRASE ne suffit pas (elle a déjà été contournée par
// synonyme : "notre équipe vous contactera très rapidement" au lieu de "je
// transmets votre question à notre équipe") — c'est le COMPORTEMENT qui est
// interdit, avec une liste de synonymes connus.
export const ESCALATION_BAN_RULE = `INTERDICTION de toute formule d'attente vague, y compris par synonyme : "je transmets votre question à notre équipe", "notre équipe vous contactera", "très rapidement", "dans les meilleurs délais", "nous revenons vers vous", ou toute variation similaire. Ce n'est pas une interdiction de phrase précise, c'est une interdiction du COMPORTEMENT "promettre sans engager".
Si tu ne sais vraiment pas : donne un engagement PRÉCIS avec délai concret, ex: "Je vérifie ce point et je vous confirme aujourd'hui" — jamais une promesse vague sans délai.`;
