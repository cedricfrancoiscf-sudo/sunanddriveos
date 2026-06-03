export const PAYOUT_TO_BASE_RATIO = 1.2544
export const PAYOUT_TO_GROSS_RATIO = 0.9297

export function getEffectivePayout(
  ownerPayout: number | null | undefined,
  grossRevenue: number | null | undefined
): number {
  if (ownerPayout != null && ownerPayout > 0) return ownerPayout
  if (grossRevenue != null && grossRevenue > 0)
    return Math.round(grossRevenue * PAYOUT_TO_GROSS_RATIO * 100) / 100
  return 0
}

export function isPayoutReal(ownerPayout: number | null | undefined): boolean {
  return ownerPayout != null && ownerPayout > 0
}
