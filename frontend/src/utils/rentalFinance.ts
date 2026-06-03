// Utilitaire central : statut financier d'une location
// Règle : une location = UN seul état, jamais additionner deux états pour la même

export type FinancialStatus = 'encaisse' | 'a_encaisser' | 'previsionnel';

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
  ownerPayoutEstimated?: number | null;
}): RentalFinancial {
  if (rental.status === 'cancelled') {
    return { status: 'previsionnel', amount: 0, color: 'blue', label: 'Annulée' };
  }

  const grossRev = Math.max(0, rental.grossRevenue ?? 0);
  // Estimation payout = 70% grossRevenue (Getaround prend ~30%)
  const estimated = rental.ownerPayoutEstimated != null && rental.ownerPayoutEstimated > 0
    ? rental.ownerPayoutEstimated
    : Math.round(grossRev * 0.70 * 100) / 100;

  const hasPayout = (rental.ownerPayout ?? 0) > 0;

  if (rental.status === 'booked' || rental.status === 'active') {
    const amount = hasPayout ? Math.max(0, rental.ownerPayout!) : estimated;
    return { status: 'previsionnel', amount, color: 'blue', label: 'Prévisionnel' };
  }

  // completed / checked_out
  if (hasPayout) {
    return { status: 'encaisse', amount: Math.max(0, rental.ownerPayout!), color: 'green', label: 'Encaissé' };
  }

  // completed sans payout encore
  return { status: 'a_encaisser', amount: estimated, color: 'blue', label: 'À encaisser' };
}
