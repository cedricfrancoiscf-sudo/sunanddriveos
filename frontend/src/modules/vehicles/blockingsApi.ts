import { api } from '../../utils/api';

export interface Blocking {
  id: string;
  vehicleId: string;
  startAt: string;
  endAt: string;
  reason: string | null;
  type: 'maintenance' | 'incident' | 'administrative' | 'other';
  createdById: string | null;
  createdAt: string;
  vehicle?: { id: string; make: string; model: string; licensePlate: string };
}

export const BLOCKING_TYPE_LABELS: Record<string, string> = {
  maintenance: 'Entretien',
  incident: 'Incident',
  administrative: 'Administratif',
  other: 'Autre',
};

export const BLOCKING_TYPE_COLORS: Record<string, string> = {
  maintenance: 'bg-blue-100 text-blue-700',
  incident: 'bg-red-100 text-red-700',
  administrative: 'bg-purple-100 text-purple-700',
  other: 'bg-orange-100 text-orange-700',
};

export const blockingsApi = {
  list: (vehicleId?: string, from?: string, to?: string) =>
    api.get<{ blockings: Blocking[] }>('/blockings', { params: { vehicleId, from, to } }).then(r => r.data.blockings),

  create: (data: { vehicleId: string; startAt: string; endAt: string; reason?: string; type: string }) =>
    api.post<{ blocking: Blocking }>('/blockings', data).then(r => r.data.blocking),

  update: (id: string, data: { startAt?: string; endAt?: string; reason?: string | null; type?: string }) =>
    api.put<{ blocking: Blocking }>(`/blockings/${id}`, data).then(r => r.data.blocking),

  delete: (id: string) =>
    api.delete(`/blockings/${id}`),
};
