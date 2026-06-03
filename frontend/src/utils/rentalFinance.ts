// Règle fondamentale CA — sans ratio, sans estimation :
// ownerPayout > 0  → ENCAISSÉ (vert)
// sinon            → PRÉVISIONNEL = grossRevenue (bleu)

export type FinancialStatus = 'encaisse' | 'previsionnel';

export interface RentalFinancial {
  status: FinancialStatus;
  amount: number;
  color: 'green' | 'blue';
  label: string;
}

export function getRentalFinancialStatus(rental: {
  status: string;
  ownerPayout?: number | null;
  grossRevenue?: number | null;
}): RentalFinancial {
  if (rental.status === 'cancelled') {
    return { status: 'previsionnel', amount: 0, color: 'blue', label: 'Annulée' };
  }
  if ((rental.ownerPayout ?? 0) > 0) {
    return { status: 'encaisse', amount: rental.ownerPayout!, color: 'green', label: 'Encaissé' };
  }
  const amount = Math.max(0, rental.grossRevenue ?? 0);
  return { status: 'previsionnel', amount, color: 'blue', label: 'Prévisionnel' };
}
