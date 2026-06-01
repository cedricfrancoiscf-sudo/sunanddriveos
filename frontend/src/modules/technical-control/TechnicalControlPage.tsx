import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, isPast, differenceInDays } from 'date-fns';
import { fr } from 'date-fns/locale';
import { api } from '../../utils/api';

interface TechnicalControl {
  id: string;
  performedAt: string;
  expiryAt: string;
  result: 'pass' | 'advisory' | 'fail';
  center: string | null;
  cost: number | null;
  vehicle: { id: string; make: string; model: string; licensePlate: string };
}

const RESULT_LABELS = { pass: 'Favorable', advisory: 'Défavorable mineur', fail: 'Défavorable majeur' };
const RESULT_COLORS = { pass: 'bg-green-100 text-green-700', advisory: 'bg-yellow-100 text-yellow-700', fail: 'bg-red-100 text-red-700' };

const ctApi = {
  list: (vehicleId?: string) =>
    api.get<{ controls: TechnicalControl[] }>('/technical-control', { params: { vehicleId } }).then(r => r.data.controls),
  expiring: () =>
    api.get<{ controls: TechnicalControl[] }>('/technical-control/expiring').then(r => r.data.controls),
  create: (data: object) =>
    api.post<{ control: TechnicalControl }>('/technical-control', data).then(r => r.data.control),
  delete: (id: string) => api.delete(`/technical-control/${id}`),
};

const EMPTY = { vehicleId: '', performedAt: '', expiryAt: '', result: 'pass' as 'pass' | 'advisory' | 'fail', center: '', cost: '' };

export default function TechnicalControlPage(): React.JSX.Element {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);

  const { data: controls = [], isLoading } = useQuery({ queryKey: ['technical-controls'], queryFn: () => ctApi.list(), staleTime: 5 * 60_000 });
  const { data: expiring = [] } = useQuery({ queryKey: ['ct-expiring'], queryFn: ctApi.expiring, staleTime: 5 * 60_000 });
  const { data: vehiclesData } = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => api.get<{ vehicles: { id: string; make: string; model: string; licensePlate: string }[] }>('/vehicles').then(r => r.data.vehicles),
    staleTime: 5 * 60_000,
  });

  const createMutation = useMutation({
    mutationFn: (data: object) => ctApi.create(data),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['technical-controls'] }); void qc.invalidateQueries({ queryKey: ['ct-expiring'] }); setShowForm(false); setForm(EMPTY); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => ctApi.delete(id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['technical-controls'] }); void qc.invalidateQueries({ queryKey: ['ct-expiring'] }); },
  });

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    createMutation.mutate({
      vehicleId: form.vehicleId,
      performedAt: new Date(form.performedAt).toISOString(),
      expiryAt: new Date(form.expiryAt).toISOString(),
      result: form.result,
      center: form.center || undefined,
      cost: form.cost ? parseFloat(form.cost) : undefined,
    });
  }

  const expiringIds = new Set(expiring.map(c => c.id));

  return (
    <div className="p-4 lg:p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Contrôle technique</h1>
          <p className="text-sm text-gray-500">{controls.length} contrôle{controls.length !== 1 ? 's' : ''}</p>
        </div>
        <button type="button" onClick={() => setShowForm(true)}
          className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white" style={{ backgroundColor: '#01696e' }}>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Ajouter
        </button>
      </div>

      {expiring.length > 0 && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="mb-2 text-sm font-semibold text-red-700">{expiring.length} CT expirant dans les 60 jours</p>
          <div className="space-y-1">
            {expiring.map(c => {
              const days = differenceInDays(new Date(c.expiryAt), new Date());
              return (
                <p key={c.id} className="text-xs text-red-600">
                  {c.vehicle.make} {c.vehicle.model} ({c.vehicle.licensePlate}) — expire le {format(new Date(c.expiryAt), 'dd/MM/yyyy', { locale: fr })}
                  {days < 0 ? ' (expiré)' : ` (dans ${days} j)`}
                </p>
              );
            })}
          </div>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="mb-6 rounded-2xl border border-[#01696e]/20 bg-[#01696e]/5 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-900">Nouveau contrôle technique</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Véhicule *</label>
              <select required value={form.vehicleId} onChange={e => setForm(f => ({ ...f, vehicleId: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]">
                <option value="">Sélectionner...</option>
                {vehiclesData?.map(v => <option key={v.id} value={v.id}>{v.make} {v.model} — {v.licensePlate}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Résultat *</label>
              <select value={form.result} onChange={e => setForm(f => ({ ...f, result: e.target.value as 'pass' | 'advisory' | 'fail' }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]">
                <option value="pass">Favorable</option>
                <option value="advisory">Défavorable mineur</option>
                <option value="fail">Défavorable majeur</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Date de réalisation *</label>
              <input type="date" required value={form.performedAt} onChange={e => setForm(f => ({ ...f, performedAt: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Date d'expiration *</label>
              <input type="date" required value={form.expiryAt} onChange={e => setForm(f => ({ ...f, expiryAt: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Centre</label>
              <input type="text" value={form.center} onChange={e => setForm(f => ({ ...f, center: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" placeholder="Centre Contrôle Auto" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Coût (€)</label>
              <input type="number" min={0} step="0.01" value={form.cost} onChange={e => setForm(f => ({ ...f, cost: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" placeholder="75.00" />
            </div>
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

      {isLoading ? (
        <div className="flex justify-center py-16"><div className="h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" style={{ borderColor: '#01696e', borderTopColor: 'transparent' }} /></div>
      ) : controls.length === 0 ? (
        <div className="py-16 text-center"><p className="text-gray-400">Aucun contrôle technique enregistré</p></div>
      ) : (
        <div className="space-y-2">
          {controls.map(c => {
            const expired = isPast(new Date(c.expiryAt));
            const isExpiring = expiringIds.has(c.id);
            return (
              <div key={c.id} className={`flex items-center gap-4 rounded-xl border bg-white px-4 py-3 shadow-sm ${expired ? 'border-red-200' : isExpiring ? 'border-orange-200' : 'border-gray-200'}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-900">{c.vehicle.make} {c.vehicle.model}</span>
                    <span className="text-xs text-gray-400 tracking-wide">{c.vehicle.licensePlate}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${RESULT_COLORS[c.result]}`}>{RESULT_LABELS[c.result]}</span>
                    {expired && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">EXPIRÉ</span>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-3 text-xs text-gray-500">
                    <span>Réalisé le {format(new Date(c.performedAt), 'dd/MM/yyyy', { locale: fr })}</span>
                    <span className={expired ? 'text-red-600 font-medium' : isExpiring ? 'text-orange-600' : ''}>
                      Expire le {format(new Date(c.expiryAt), 'dd/MM/yyyy', { locale: fr })}
                    </span>
                    {c.center && <span>{c.center}</span>}
                    {c.cost != null && <span>{c.cost.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</span>}
                  </div>
                </div>
                <button type="button" onClick={() => { if (confirm('Supprimer ce contrôle ?')) deleteMutation.mutate(c.id); }}
                  className="shrink-0 p-1 text-gray-300 hover:text-red-500">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
