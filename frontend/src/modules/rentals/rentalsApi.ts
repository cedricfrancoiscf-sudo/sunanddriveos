import { api } from '../../utils/api';

export type RentalStatus = 'booked' | 'active' | 'completed' | 'cancelled';
export type EvaluationStatus = 'pending' | 'posted' | 'blocked';

export interface Rental {
  id: string;
  getaroundId: string;
  vehicleId: string;
  vehicle: { id: string; make: string; model: string; licensePlate: string; photoUrl: string | null };
  driverName: string;
  driverEmail: string | null;
  driverGetaroundId: string | null;
  startAt: string;
  endAt: string;
  startMileage: number | null;
  endMileage: number | null;
  kmDriven: number | null;
  fuelLevelCheckin: number | null;
  fuelLevelCheckout: number | null;
  grossRevenue: number | null;
  ownerPayout: number | null;
  ownerPayoutEstimated: number | null;
  basePrice: number | null;
  extraDistanceFee: number | null;
  insuranceFee: number | null;
  assistanceFee: number | null;
  deliveryFee: number | null;
  driverMessFee: number | null;
  damageCompensation: number | null;
  gasRefillFee: number | null;
  lateReturnFee: number | null;
  status: RentalStatus;
  evaluationStatus: EvaluationStatus;
  evaluationRating: number | null;
  evaluationComment: string | null;
}

export interface RentalDetail extends Rental {
  messages: Array<{
    id: string;
    direction: 'inbound' | 'outbound';
    content: string;
    sentAt: string | null;
    status: string;
    aiSuggestion: string | null;
  }>;
  incidents: Array<{ id: string; type: string; status: string; description: string; cost: number | null }>;
  _count: { messages: number };
}

export interface RentalStats {
  totalRevenue: number;
  totalPayout: number;
  totalEncaisse: number;
  totalPrevisionnel: number;
  totalKm: number;
  rentalCount: number;
  countDone: number;
  countUpcoming: number;
  occupancyRate: number;
  vehicleCount: number;
}

export interface RentalFilters {
  vehicleId?: string;
  status?: RentalStatus;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export const rentalsApi = {
  list: (filters: RentalFilters = {}) =>
    api
      .get<{ rentals: Rental[]; total: number; page: number; limit: number }>('/rentals', { params: filters })
      .then((r) => r.data),

  get: (id: string) =>
    api.get<{ rental: RentalDetail }>(`/rentals/${id}`).then((r) => r.data.rental),

  update: (id: string, data: Partial<Rental>) =>
    api.put<{ rental: Rental }>(`/rentals/${id}`, data).then((r) => r.data.rental),

  stats: (from?: string, to?: string) =>
    api
      .get<{ stats: RentalStats; period: { from: string; to: string } }>('/rentals/stats', { params: { from, to } })
      .then((r) => r.data),

  syncRentals: (accountId: string) =>
    api
      .post<{ result: { created: number; updated: number; errors: string[] } }>(
        `/getaround-sync/sync-rentals/${accountId}`,
      )
      .then((r) => r.data.result),
};
