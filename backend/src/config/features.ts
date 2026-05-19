// Drapeaux de fonctionnalités — active/désactive les modules
// Modules futurs désactivés jusqu'à leur implémentation

export const FEATURES = {
  // Modules V1 actifs
  vehicles: true,
  rentals: true,
  messages: true,
  sequences: true,
  maintenance: true,
  technicalControl: true,
  vehicleChecks: true,
  documents: true,
  planning: true,
  blocking: true,
  accessories: true,
  carSeats: true,
  export: true,
  users: true,
  settings: true,
  onboarding: true,
  notifications: true,
  scoring: true,
  ai: true,
  stripe: true,
  superadmin: true,
  thirdPartyOwners: true,
  tvDashboard: true,
  // Modules futurs — désactivés
  payments: false,
  directRental: false,
  contracts: false,
  identityCheck: false,
  apiPublic: false,
  turoSync: false,
  profitability: false,
  vehicleValuation: false,
  carbonTracking: false,
  ratings: false,
  googleMyBusiness: false,
} as const;

export type FeatureKey = keyof typeof FEATURES;

export function isFeatureEnabled(feature: FeatureKey): boolean {
  return FEATURES[feature];
}
