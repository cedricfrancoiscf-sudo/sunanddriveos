// Règle fondamentale CA — appliquée partout sans exception :
// ownerPayout > 0  → CA ENCAISSÉ (vert)
// ownerPayout null ou 0 → CA PRÉVISIONNEL = grossRevenue (bleu)
// Jamais de ratio, jamais d'estimation.

export type CAType = 'encaisse' | 'previsionnel';

export interface CA {
  amount: number;
  type: CAType;
}

export function getCA(
  ownerPayout: number | null | undefined,
  grossRevenue: number | null | undefined,
): CA {
  if (ownerPayout != null && ownerPayout > 0) {
    return { amount: ownerPayout, type: 'encaisse' };
  }
  if (grossRevenue != null && grossRevenue > 0) {
    return { amount: grossRevenue, type: 'previsionnel' };
  }
  return { amount: 0, type: 'previsionnel' };
}

export function isPayoutReal(ownerPayout: number | null | undefined): boolean {
  return ownerPayout != null && ownerPayout > 0;
}
