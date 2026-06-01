import { api } from '../../utils/api';

export type TriggerEvent = 'rental.booked' | 'rental.car_checked_in' | 'rental.car_checked_out' | 'rental.before_checkin' | 'rental.before_checkout';

export interface Sequence {
  id: string;
  name: string;
  triggerEvent: TriggerEvent;
  delayMinutes: number;
  content: string;
  isActive: boolean;
  vehicleId: string | null;
  createdAt: string;
  updatedAt: string;
  _count: { executions: number };
}

export type SequenceInput = {
  name: string;
  triggerEvent: TriggerEvent;
  delayMinutes: number;
  content: string;
  vehicleId?: string;
};

export const TRIGGER_LABELS: Record<TriggerEvent, string> = {
  'rental.booked': 'Réservation confirmée',
  'rental.before_checkin': 'Avant la prise en charge',
  'rental.car_checked_in': 'Prise en charge du véhicule',
  'rental.before_checkout': 'Avant la restitution',
  'rental.car_checked_out': 'Restitution du véhicule',
};

export const DELAY_LABELS: Record<TriggerEvent, string> = {
  'rental.booked': 'Délai après la réservation',
  'rental.before_checkin': 'Envoyer avant la prise en charge',
  'rental.car_checked_in': 'Délai après la prise en charge',
  'rental.before_checkout': 'Envoyer avant la restitution',
  'rental.car_checked_out': 'Délai après la restitution',
};

// Ces déclencheurs utilisent le délai comme "temps avant l'événement"
export const BEFORE_TRIGGERS: TriggerEvent[] = ['rental.before_checkin', 'rental.before_checkout'];

export const TEMPLATE_VARS = [
  { key: '{{driver_name}}', label: 'Prénom du locataire' },
  { key: '{{vehicle}}', label: 'Véhicule (marque + modèle)' },
  { key: '{{license_plate}}', label: 'Immatriculation' },
  { key: '{{start_date}}', label: 'Date de début' },
  { key: '{{end_date}}', label: 'Date de fin' },
];

export const sequencesApi = {
  list: () =>
    api.get<{ sequences: Sequence[] }>('/sequences').then((r) => r.data.sequences),

  create: (data: SequenceInput) =>
    api.post<{ sequence: Sequence }>('/sequences', data).then((r) => r.data.sequence),

  update: (id: string, data: Partial<SequenceInput> & { isActive?: boolean }) =>
    api.put<{ sequence: Sequence }>(`/sequences/${id}`, data).then((r) => r.data.sequence),

  toggle: (id: string) =>
    api.post<{ sequence: Sequence }>(`/sequences/${id}/toggle`).then((r) => r.data.sequence),

  delete: (id: string) =>
    api.delete(`/sequences/${id}`),
};
