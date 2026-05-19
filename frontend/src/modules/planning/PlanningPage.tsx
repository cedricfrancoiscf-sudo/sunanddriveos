import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, addDays, startOfWeek, differenceInDays, parseISO, isSameDay } from 'date-fns';
import { fr } from 'date-fns/locale';
import { api } from '../../utils/api';

interface Vehicle { id: string; make: string; model: string; licensePlate: string; photoUrl: string | null; }
interface PlanningRental { id: string; vehicleId: string; driverName: string; startAt: string; endAt: string; status: string; }
interface PlanningBlocking { id: string; vehicleId: string; reason: string | null; type: string; startAt: string; endAt: string; }

const BLOCKING_TYPES: Record<string, string> = {
  maintenance: 'Maintenance', incident: 'Incident',
  administrative: 'Administratif', other: 'Autre',
};
const BLOCKING_COLORS: Record<string, string> = {
  maintenance: 'bg-orange-400', incident: 'bg-red-500',
  administrative: 'bg-purple-400', other: 'bg-gray-400',
};

const DAYS = 14;

function getBarStyle(startAt: string, endAt: string, periodStart: Date): React.CSSProperties {
  const start = parseISO(startAt);
  const end = parseISO(endAt);
  const dayStart = Math.max(0, differenceInDays(start, periodStart));
  const dayEnd = Math.min(DAYS, differenceInDays(end, periodStart) + 1);
  const width = Math.max(1, dayEnd - dayStart);
  return {
    left: `${(dayStart / DAYS) * 100}%`,
    width: `${(width / DAYS) * 100}%`,
  };
}

export default function PlanningPage(): React.JSX.Element {
  const qc = useQueryClient();
  const [periodStart, setPeriodStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const periodEnd = addDays(periodStart, DAYS - 1);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ vehicleId: '', type: 'maintenance', reason: '', startAt: '', endAt: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['planning', periodStart.toISOString()],
    queryFn: () => api.get<{ rentals: PlanningRental[]; blockings: PlanningBlocking[]; vehicles: Vehicle[] }>(
      '/planning',
      { params: { from: periodStart.toISOString(), to: periodEnd.toISOString() } }
    ).then(r => r.data),
  });

  const createBlocking = useMutation({
    mutationFn: (body: object) => api.post('/planning/blockings', body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['planning'] }); setShowForm(false); setForm({ vehicleId: '', type: 'maintenance', reason: '', startAt: '', endAt: '' }); },
  });

  const deleteBlocking = useMutation({
    mutationFn: (id: string) => api.delete(`/planning/blockings/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['planning'] }),
  });

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    createBlocking.mutate({
      vehicleId: form.vehicleId,
      type: form.type,
      reason: form.reason || undefined,
      startAt: new Date(form.startAt).toISOString(),
      endAt: new Date(form.endAt).toISOString(),
    });
  }

  const days = Array.from({ length: DAYS }, (_, i) => addDays(periodStart, i));
  const vehicles = data?.vehicles ?? [];
  const rentals = data?.rentals ?? [];
  const blockings = data?.blockings ?? [];
  const today = new Date();

  return (
    <div className="p-4 lg:p-6">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900">Planning</h1>
          <p className="text-sm text-gray-500">
            {format(periodStart, 'd MMM', { locale: fr })} — {format(periodEnd, 'd MMM yyyy', { locale: fr })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setPeriodStart(d => addDays(d, -DAYS))}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50">←</button>
          <button type="button" onClick={() => setPeriodStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50">Auj.</button>
          <button type="button" onClick={() => setPeriodStart(d => addDays(d, DAYS))}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50">→</button>
          <button type="button" onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white" style={{ backgroundColor: '#01696e' }}>
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            Blocage
          </button>
        </div>
      </div>

      {/* Form blocage */}
      {showForm && (
        <form onSubmit={handleSubmit} className="mb-6 rounded-2xl border border-orange-200 bg-orange-50 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-900">Nouveau blocage</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Véhicule *</label>
              <select required value={form.vehicleId} onChange={e => setForm(f => ({ ...f, vehicleId: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#01696e]">
                <option value="">Sélectionner...</option>
                {vehicles.map(v => <option key={v.id} value={v.id}>{v.make} {v.model} — {v.licensePlate}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Type *</label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#01696e]">
                {Object.entries(BLOCKING_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Raison</label>
              <input type="text" value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#01696e]" placeholder="Révision 100 000 km..." />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Début *</label>
              <input required type="datetime-local" value={form.startAt} onChange={e => setForm(f => ({ ...f, startAt: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Fin *</label>
              <input required type="datetime-local" value={form.endAt} onChange={e => setForm(f => ({ ...f, endAt: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={createBlocking.isPending}
              className="rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" style={{ backgroundColor: '#01696e' }}>
              {createBlocking.isPending ? 'Enregistrement...' : 'Enregistrer'}
            </button>
            <button type="button" onClick={() => setShowForm(false)}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Annuler</button>
          </div>
        </form>
      )}

      {/* Légende */}
      <div className="mb-4 flex flex-wrap items-center gap-3 text-xs">
        <div className="flex items-center gap-1.5"><div className="h-3 w-6 rounded-sm bg-[#01696e]/70" /> Location</div>
        {Object.entries(BLOCKING_TYPES).map(([k, v]) => (
          <div key={k} className="flex items-center gap-1.5">
            <div className={`h-3 w-6 rounded-sm ${BLOCKING_COLORS[k]}`} /> {v}
          </div>
        ))}
      </div>

      {/* Timeline */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" style={{ borderColor: '#01696e', borderTopColor: 'transparent' }} />
        </div>
      ) : vehicles.length === 0 ? (
        <div className="py-16 text-center text-gray-400">Aucun véhicule actif</div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
          {/* En-tête jours */}
          <div className="flex border-b border-gray-200">
            <div className="w-40 shrink-0 border-r border-gray-200 px-3 py-2 text-xs font-semibold text-gray-500">Véhicule</div>
            <div className="flex flex-1 min-w-[600px]">
              {days.map(day => (
                <div key={day.toISOString()}
                  className={`flex-1 border-r border-gray-100 px-1 py-2 text-center text-xs ${isSameDay(day, today) ? 'bg-[#01696e]/5 font-bold text-[#01696e]' : 'text-gray-500'}`}>
                  <div>{format(day, 'EEE', { locale: fr })}</div>
                  <div>{format(day, 'd')}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Lignes véhicules */}
          {vehicles.map(v => {
            const vRentals = rentals.filter(r => r.vehicleId === v.id);
            const vBlockings = blockings.filter(b => b.vehicleId === v.id);
            return (
              <div key={v.id} className="flex border-b border-gray-100 last:border-0">
                {/* Nom véhicule */}
                <div className="w-40 shrink-0 border-r border-gray-200 px-3 py-3">
                  <p className="text-xs font-semibold text-gray-800 truncate">{v.make} {v.model}</p>
                  <p className="text-xs font-mono text-gray-400">{v.licensePlate}</p>
                </div>
                {/* Barre timeline */}
                <div className="relative flex-1 min-w-[600px] h-14">
                  {/* Grille jours */}
                  <div className="absolute inset-0 flex">
                    {days.map(day => (
                      <div key={day.toISOString()}
                        className={`flex-1 border-r border-gray-100 ${isSameDay(day, today) ? 'bg-[#01696e]/5' : ''}`} />
                    ))}
                  </div>
                  {/* Rentals */}
                  {vRentals.map(r => (
                    <div key={r.id} className="absolute top-2 h-4 rounded-sm bg-[#01696e]/70 flex items-center px-1 overflow-hidden"
                      style={getBarStyle(r.startAt, r.endAt, periodStart)}
                      title={`${r.driverName} — ${format(parseISO(r.startAt), 'dd/MM')} au ${format(parseISO(r.endAt), 'dd/MM')}`}>
                      <span className="text-[10px] text-white font-medium truncate">{r.driverName}</span>
                    </div>
                  ))}
                  {/* Blockings */}
                  {vBlockings.map(b => (
                    <div key={b.id} className={`absolute top-8 h-4 rounded-sm ${BLOCKING_COLORS[b.type]} flex items-center px-1 overflow-hidden group`}
                      style={getBarStyle(b.startAt, b.endAt, periodStart)}
                      title={`${BLOCKING_TYPES[b.type]}${b.reason ? ` — ${b.reason}` : ''}`}>
                      <span className="text-[10px] text-white font-medium truncate flex-1">{b.reason ?? BLOCKING_TYPES[b.type]}</span>
                      <button type="button"
                        onClick={() => { if (confirm('Supprimer ce blocage ?')) deleteBlocking.mutate(b.id); }}
                        className="hidden group-hover:block text-white/80 hover:text-white ml-0.5">
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
