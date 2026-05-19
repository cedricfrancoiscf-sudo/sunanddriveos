import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, isPast, differenceInDays } from 'date-fns';
import { fr } from 'date-fns/locale';
import { api } from '../../utils/api';

interface Maintenance {
  id: string;
  type: string;
  performedAt: string;
  mileageAtService: number;
  nextServiceDate: string | null;
  nextServiceMileage: number | null;
  cost: number | null;
  provider: string | null;
  notes: string | null;
  vehicle: { id: string; make: string; model: string; licensePlate: string };
}

const TYPES = ['vidange', 'freins', 'pneus', 'courroie', 'filtres', 'révision', 'autre'];

const maintenanceApi = {
  list: (vehicleId?: string) =>
    api.get<{ maintenances: Maintenance[] }>('/maintenance', { params: { vehicleId } }).then((r) => r.data.maintenances),
  create: (data: object) =>
    api.post<{ maintenance: Maintenance }>('/maintenance', data).then((r) => r.data.maintenance),
  delete: (id: string) => api.delete(`/maintenance/${id}`),
};

function StatusDot({ nextDate }: { nextDate: string | null }): React.JSX.Element {
  if (!nextDate) return <span className="h-2 w-2 rounded-full bg-gray-200" />;
  const d = new Date(nextDate);
  if (isPast(d)) return <span className="h-2 w-2 rounded-full bg-red-500" title="Dépassé" />;
  const days = differenceInDays(d, new Date());
  if (days <= 30) return <span className="h-2 w-2 rounded-full bg-orange-400" title={`Dans ${days} j`} />;
  return <span className="h-2 w-2 rounded-full bg-green-400" />;
}

export default function MaintenancePage(): React.JSX.Element {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    vehicleId: '', type: 'vidange', performedAt: new Date().toISOString().slice(0, 16),
    mileageAtService: '', nextServiceDate: '', nextServiceMileage: '', cost: '', provider: '', notes: '',
  });

  const { data: maintenances = [], isLoading } = useQuery({
    queryKey: ['maintenances'],
    queryFn: () => maintenanceApi.list(),
  });

  // Charger les véhicules pour le select
  const { data: vehiclesData } = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => api.get<{ vehicles: { id: string; make: string; model: string; licensePlate: string }[] }>('/vehicles').then((r) => r.data.vehicles),
  });

  const createMutation = useMutation({
    mutationFn: (data: object) => maintenanceApi.create(data),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['maintenances'] }); setShowForm(false); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => maintenanceApi.delete(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['maintenances'] }),
  });

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    createMutation.mutate({
      vehicleId: form.vehicleId,
      type: form.type,
      performedAt: new Date(form.performedAt).toISOString(),
      mileageAtService: parseInt(form.mileageAtService, 10),
      nextServiceDate: form.nextServiceDate ? new Date(form.nextServiceDate).toISOString() : undefined,
      nextServiceMileage: form.nextServiceMileage ? parseInt(form.nextServiceMileage, 10) : undefined,
      cost: form.cost ? parseFloat(form.cost) : undefined,
      provider: form.provider || undefined,
      notes: form.notes || undefined,
    });
  }

  const upcoming = maintenances.filter((m) => {
    if (!m.nextServiceDate) return false;
    const days = differenceInDays(new Date(m.nextServiceDate), new Date());
    return days <= 30;
  });

  return (
    <div className="p-4 lg:p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Entretiens</h1>
          <p className="text-sm text-gray-500">{maintenances.length} entretien{maintenances.length !== 1 ? 's' : ''} enregistré{maintenances.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white"
          style={{ backgroundColor: '#01696e' }}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Ajouter
        </button>
      </div>

      {/* Alertes à venir */}
      {upcoming.length > 0 && (
        <div className="mb-4 rounded-xl border border-orange-200 bg-orange-50 p-4">
          <p className="mb-2 text-sm font-semibold text-orange-700">
            {upcoming.length} entretien{upcoming.length > 1 ? 's' : ''} à prévoir dans les 30 jours
          </p>
          <div className="space-y-1">
            {upcoming.map((m) => (
              <p key={m.id} className="text-xs text-orange-600">
                {m.vehicle.make} {m.vehicle.model} ({m.vehicle.licensePlate}) — {m.type} · {format(new Date(m.nextServiceDate!), 'dd/MM/yyyy', { locale: fr })}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Formulaire */}
      {showForm && (
        <form onSubmit={handleSubmit} className="mb-6 rounded-2xl border border-[#01696e]/20 bg-[#01696e]/5 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-900">Nouvel entretien</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Véhicule *</label>
              <select required value={form.vehicleId} onChange={(e) => setForm((f) => ({ ...f, vehicleId: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]">
                <option value="">Sélectionner...</option>
                {vehiclesData?.map((v) => <option key={v.id} value={v.id}>{v.make} {v.model} — {v.licensePlate}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Type *</label>
              <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]">
                {TYPES.map((t) => <option key={t} value={t} className="capitalize">{t}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Date réalisé *</label>
              <input type="datetime-local" required value={form.performedAt} onChange={(e) => setForm((f) => ({ ...f, performedAt: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Kilométrage au service *</label>
              <input type="number" required min={0} value={form.mileageAtService} onChange={(e) => setForm((f) => ({ ...f, mileageAtService: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" placeholder="50000" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Prochain entretien (date)</label>
              <input type="date" value={form.nextServiceDate} onChange={(e) => setForm((f) => ({ ...f, nextServiceDate: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Prochain entretien (km)</label>
              <input type="number" min={0} value={form.nextServiceMileage} onChange={(e) => setForm((f) => ({ ...f, nextServiceMileage: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" placeholder="60000" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Coût (€)</label>
              <input type="number" min={0} step="0.01" value={form.cost} onChange={(e) => setForm((f) => ({ ...f, cost: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" placeholder="120.00" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Prestataire</label>
              <input type="text" value={form.provider} onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" placeholder="Garage Dupont" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Notes</label>
            <textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={createMutation.isPending}
              className="rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" style={{ backgroundColor: '#01696e' }}>
              {createMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
            </button>
            <button type="button" onClick={() => setShowForm(false)}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Annuler</button>
          </div>
        </form>
      )}

      {/* Liste */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" style={{ borderColor: '#01696e', borderTopColor: 'transparent' }} />
        </div>
      ) : maintenances.length === 0 ? (
        <div className="py-16 text-center"><p className="text-gray-400">Aucun entretien enregistré</p></div>
      ) : (
        <div className="space-y-2">
          {maintenances.map((m) => (
            <div key={m.id} className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
              <StatusDot nextDate={m.nextServiceDate} />
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium capitalize text-gray-900">{m.type}</span>
                  <span className="text-xs text-gray-400">{m.vehicle.make} {m.vehicle.model} · <span className="font-mono">{m.vehicle.licensePlate}</span></span>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-3 text-xs text-gray-500">
                  <span>{format(new Date(m.performedAt), 'dd/MM/yyyy', { locale: fr })}</span>
                  <span>{m.mileageAtService.toLocaleString('fr-FR')} km</span>
                  {m.nextServiceDate && <span className="text-orange-600">→ {format(new Date(m.nextServiceDate), 'dd/MM/yyyy', { locale: fr })}</span>}
                  {m.cost != null && <span>{m.cost.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</span>}
                  {m.provider && <span>{m.provider}</span>}
                </div>
              </div>
              <button type="button" onClick={() => { if (confirm('Supprimer cet entretien ?')) deleteMutation.mutate(m.id); }}
                className="shrink-0 p-1 text-gray-300 hover:text-red-500">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
