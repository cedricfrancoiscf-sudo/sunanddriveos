import React, { useState, useMemo, useEffect } from 'react';
import { trackEvent } from '../../utils/tracking';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, addDays, startOfWeek, parseISO, isSameDay, differenceInMinutes, startOfDay } from 'date-fns';
import { fr } from 'date-fns/locale';
import { api } from '../../utils/api';
import { useAuth } from '../../hooks/useAuth';

type ViewMode = 7 | 14 | 30;

interface Vehicle {
  id: string;
  make: string;
  model: string;
  licensePlate: string;
  photoUrl: string | null;
  parkingZone: string | null;
  deliveryPointName: string | null;
}
interface PlanningRental {
  id: string;
  vehicleId: string;
  driverName: string;
  driverGetaroundId: string | null;
  startAt: string;
  endAt: string;
  status: string;
  _count: { carSeatRequests: number; accessoryReservations: number };
  carSeatRequests: Array<{ status: string }>;
}
interface PlanningBlocking {
  id: string;
  vehicleId: string;
  reason: string | null;
  type: string;
  startAt: string;
  endAt: string;
}
interface PlanningUnavailability {
  id: string;
  vehicleId: string;
  startsAt: string;
  endsAt: string;
}

const BLOCKING_LABELS: Record<string, string> = {
  maintenance: 'Maintenance',
  incident: 'Incident',
  unavailability: 'Indisponible',
};
const BLOCKING_COLORS: Record<string, string> = {
  maintenance: 'bg-orange-400',
  incident: 'bg-red-500',
  unavailability: 'bg-gray-400',
};

// Positionnement précis à la minute près dans la grille
function getBarStyle(startAt: string, endAt: string, periodStart: Date, totalDays: number): React.CSSProperties {
  const totalMin = totalDays * 24 * 60;
  const periodStartMs = startOfDay(periodStart).getTime();
  const startMin = Math.max(0, (parseISO(startAt).getTime() - periodStartMs) / 60_000);
  const endMin = Math.min(totalMin, (parseISO(endAt).getTime() - periodStartMs) / 60_000);
  const widthMin = Math.max(totalMin * 0.005, endMin - startMin); // min 0.5% de largeur
  return {
    left: `${(startMin / totalMin) * 100}%`,
    width: `${(widthMin / totalMin) * 100}%`,
  };
}

function formatHour(iso: string): string {
  return format(parseISO(iso), 'HH:mm');
}

function RentalBar({ rental, periodStart, totalDays, onClick, isBlacklisted }: { rental: PlanningRental; periodStart: Date; totalDays: number; onClick: () => void; isBlacklisted: boolean }) {
  const hasCarSeat = rental.carSeatRequests.length > 0;
  const hasAccessory = rental._count.accessoryReservations > 0;
  const tooltip = `${rental.driverName}${isBlacklisted ? ' ⛔' : ''}\n${format(parseISO(rental.startAt), 'dd/MM HH:mm', { locale: fr })} → ${format(parseISO(rental.endAt), 'dd/MM HH:mm', { locale: fr })}${hasCarSeat ? '\n🪑 Siège auto' : ''}${hasAccessory ? '\n📦 Accessoire' : ''}`;
  const durationMin = differenceInMinutes(parseISO(rental.endAt), parseISO(rental.startAt));
  const isShort = durationMin < 120; // moins de 2h — barre courte, pas de texte
  const isPast = parseISO(rental.endAt) < startOfDay(new Date());

  return (
    <div
      className={`absolute top-1.5 h-7 rounded flex items-center overflow-hidden cursor-pointer group z-10 transition-opacity hover:opacity-90 ${isPast ? 'opacity-50' : ''}`}
      style={{
        ...getBarStyle(rental.startAt, rental.endAt, periodStart, totalDays),
        backgroundColor: hasCarSeat
          ? (rental.status === 'active' ? '#c2600a' : '#c2600aaa')
          : (rental.status === 'active' ? '#01696e' : '#01696eaa'),
      }}
      title={tooltip}
      onClick={onClick}
    >
      {!isShort && (
        <span className="flex items-center gap-0.5 pl-1.5 text-[10px] text-white font-medium truncate min-w-0">
          {isBlacklisted && <span className="shrink-0 text-[9px]">⛔</span>}
          <span className="truncate">{formatHour(rental.startAt)} {rental.driverName}</span>
          {hasCarSeat && <span className="shrink-0 text-[9px] ml-0.5 opacity-90">🪑</span>}
          {hasAccessory && <span className="shrink-0 text-[9px] opacity-90">📦</span>}
        </span>
      )}
      {isShort && (hasCarSeat || hasAccessory) && (
        <span className="flex items-center gap-0.5 pl-0.5 text-[9px]">
          {hasCarSeat && <span>🪑</span>}
          {hasAccessory && <span>📦</span>}
        </span>
      )}
      {/* Tooltip riche au survol */}
      <div className="absolute bottom-full left-0 z-50 mb-1 hidden group-hover:block pointer-events-none">
        <div className="rounded-lg bg-gray-900 px-2.5 py-2 text-[11px] text-white shadow-lg whitespace-nowrap">
          <p className="font-semibold">{rental.driverName}{isBlacklisted && <span className="ml-1 rounded-full bg-red-500 px-1 text-[9px]">⛔ BL</span>}</p>
          <p className="text-gray-300">{format(parseISO(rental.startAt), 'dd MMM HH:mm', { locale: fr })} → {format(parseISO(rental.endAt), 'dd MMM HH:mm', { locale: fr })}</p>
          {hasCarSeat && <p className="text-blue-300 mt-0.5">🪑 Siège auto requis</p>}
          {hasAccessory && <p className="text-yellow-300 mt-0.5">📦 Accessoire réservé</p>}
          {rental.status === 'active' && <p className="text-green-300 mt-0.5">● En cours</p>}
        </div>
      </div>
    </div>
  );
}

function BlockingBar({ blocking, onDelete, periodStart, totalDays }: {
  blocking: PlanningBlocking;
  onDelete: (id: string) => void;
  periodStart: Date;
  totalDays: number;
}) {
  const colorClass = BLOCKING_COLORS[blocking.type] ?? 'bg-gray-400';
  const label = blocking.reason ?? BLOCKING_LABELS[blocking.type];
  const tooltip = `${BLOCKING_LABELS[blocking.type]}${blocking.reason ? ` — ${blocking.reason}` : ''}\n${format(parseISO(blocking.startAt), 'dd/MM HH:mm', { locale: fr })} → ${format(parseISO(blocking.endAt), 'dd/MM HH:mm', { locale: fr })}`;

  return (
    <div
      className={`absolute bottom-1.5 h-5 rounded flex items-center overflow-hidden group z-10 ${colorClass}`}
      style={getBarStyle(blocking.startAt, blocking.endAt, periodStart, totalDays)}
      title={tooltip}
    >
      <span className="flex-1 truncate pl-1 text-[10px] text-white font-medium">{label}</span>
      <button
        type="button"
        onClick={() => { if (window.confirm('Supprimer ce blocage ?')) onDelete(blocking.id); }}
        className="hidden group-hover:flex shrink-0 items-center justify-center h-full w-5 text-white/70 hover:text-white hover:bg-black/20"
        title="Supprimer"
      >
        <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

function UnavailabilityBar({ unavailability, periodStart, totalDays }: {
  unavailability: PlanningUnavailability;
  periodStart: Date;
  totalDays: number;
}) {
  const tooltip = `Indisponible Getaround\n${format(parseISO(unavailability.startsAt), 'dd/MM HH:mm', { locale: fr })} → ${format(parseISO(unavailability.endsAt), 'dd/MM HH:mm', { locale: fr })}`;
  return (
    <div
      className="absolute bottom-1.5 h-5 rounded flex items-center overflow-hidden bg-gray-400 z-10 opacity-80"
      style={getBarStyle(unavailability.startsAt, unavailability.endsAt, periodStart, totalDays)}
      title={tooltip}
    >
      <span className="flex-1 truncate pl-1 text-[10px] text-white font-medium">Indisponible</span>
    </div>
  );
}

function ZoneHeader({ zone, count }: { zone: string; count: number }) {
  return (
    <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-3 py-1.5">
      <svg className="h-3.5 w-3.5 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
      <span className="text-xs font-semibold text-gray-600">{zone}</span>
      <span className="ml-1 rounded-full bg-gray-200 px-1.5 text-[10px] font-medium text-gray-500">{count}</span>
    </div>
  );
}

export default function PlanningPage(): React.JSX.Element {
  const navigate = useNavigate();
  useEffect(() => { void trackEvent('planning', 'view'); }, []);
  const qc = useQueryClient();
  const { user } = useAuth();
  const userRoles = user?.roles ?? (user?.role ? [user.role] : []);
  const isCarkeeperOnly = userRoles.includes('carkeeper') && !userRoles.includes('admin') && !userRoles.includes('exploitation') && !user?.isSuperAdmin;
  const [viewMode, setViewMode] = useState<ViewMode>(14);
  const [periodStart, setPeriodStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const periodEnd = addDays(periodStart, viewMode - 1);

  const [zoneFilter, setZoneFilter] = useState<string>(() => localStorage.getItem('planning_zone_filter') ?? '');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ vehicleId: '', type: 'maintenance', reason: '', startAt: '', endAt: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['planning', periodStart.toISOString(), viewMode],
    staleTime: 10_000,
    queryFn: () =>
      api.get<{ rentals: PlanningRental[]; blockings: PlanningBlocking[]; vehicles: Vehicle[]; unavailabilities: PlanningUnavailability[] }>(
        '/planning',
        { params: { from: periodStart.toISOString(), to: addDays(periodStart, viewMode).toISOString() } },
      ).then(r => r.data),
  });

  const { data: blacklistData } = useQuery<{ renters: Array<{ driverGetaroundId: string }> }>({
    queryKey: ['blacklist-renters'],
    queryFn: () => api.get<{ renters: Array<{ driverGetaroundId: string }> }>('/blacklist/renters').then(r => r.data),
    staleTime: 5 * 60_000,
  });
  const blacklistedIds = new Set((blacklistData?.renters ?? []).map(r => r.driverGetaroundId));

  const createBlocking = useMutation({
    mutationFn: (body: object) => api.post('/planning/blockings', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['planning'] });
      setShowForm(false);
      setForm({ vehicleId: '', type: 'maintenance', reason: '', startAt: '', endAt: '' });
    },
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

  const today = new Date();
  const days = useMemo(
    () => Array.from({ length: viewMode }, (_, i) => addDays(periodStart, i)),
    [periodStart, viewMode],
  );

  // Backend already filters vehicles/rentals by carkeeper assignment — no client-side filter needed
  const vehicles = data?.vehicles ?? [];
  const rentals = data?.rentals ?? [];
  const blockings = data?.blockings ?? [];
  const unavailabilities = data?.unavailabilities ?? [];

  // Groupement des véhicules par point de livraison
  const vehiclesByZone = useMemo(() => {
    const map: Record<string, Vehicle[]> = {};
    for (const v of vehicles) {
      const zone = v.deliveryPointName ?? 'Non assigné';
      if (!map[zone]) map[zone] = [];
      map[zone].push(v);
    }
    return map;
  }, [vehicles]);

  const zones = useMemo(() => Object.keys(vehiclesByZone).sort(), [vehiclesByZone]);

  const filteredVehiclesByZone = useMemo(() => {
    if (!zoneFilter) return vehiclesByZone;
    const filtered: Record<string, Vehicle[]> = {};
    if (vehiclesByZone[zoneFilter]) filtered[zoneFilter] = vehiclesByZone[zoneFilter];
    return filtered;
  }, [vehiclesByZone, zoneFilter]);

  function handleZoneFilter(zone: string): void {
    setZoneFilter(zone);
    localStorage.setItem('planning_zone_filter', zone);
  }

  const VIEW_LABELS: Record<ViewMode, string> = { 7: 'Semaine', 14: '14 jours', 30: 'Mois' };

  // Colonne marquant le jour courant
  const todayOffset = differenceInMinutes(today, startOfDay(periodStart));
  const todayPct = Math.max(0, Math.min(100, (todayOffset / (viewMode * 24 * 60)) * 100));
  const todayVisible = todayOffset >= 0 && todayOffset <= viewMode * 24 * 60;

  return (
    <div className="p-4 lg:p-6">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-gray-900">Planning</h1>
          <p className="text-sm text-gray-500">
            {format(periodStart, 'd MMM', { locale: fr })} — {format(periodEnd, 'd MMM yyyy', { locale: fr })}
          </p>
        </div>

        {/* Sélecteur de vue */}
        <div className="flex rounded-xl border border-gray-200 bg-white overflow-hidden">
          {([7, 14, 30] as ViewMode[]).map(v => (
            <button key={v} type="button"
              onClick={() => setViewMode(v)}
              className={`px-3 py-1.5 text-sm font-medium transition ${viewMode === v ? 'text-white' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'}`}
              style={viewMode === v ? { backgroundColor: '#01696e' } : undefined}
            >
              {VIEW_LABELS[v]}
            </button>
          ))}
        </div>

        {/* Navigation */}
        <div className="flex items-center gap-1.5">
          <button type="button" aria-label="prev" onClick={() => setPeriodStart(d => addDays(d, -viewMode))}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm hover:bg-gray-50">←</button>
          <button type="button" onClick={() => setPeriodStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm hover:bg-gray-50">Auj.</button>
          <button type="button" aria-label="next" onClick={() => setPeriodStart(d => addDays(d, viewMode))}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm hover:bg-gray-50">→</button>
        </div>

        {/* Filtre zone */}
        <select
          value={zoneFilter}
          onChange={e => handleZoneFilter(e.target.value)}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 outline-none focus:border-[#01696e]"
        >
          <option value="">Tous les points</option>
          {zones.map(z => <option key={z} value={z}>{z}</option>)}
        </select>

        <button type="button" onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white"
          style={{ backgroundColor: '#01696e' }}>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Blocage
        </button>
      </div>

      {/* Formulaire blocage */}
      {showForm && (
        <form onSubmit={handleSubmit} className="mb-5 rounded-2xl border border-orange-200 bg-orange-50 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-900">Nouveau blocage</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Véhicule *</label>
              <select required value={form.vehicleId} onChange={e => setForm(f => ({ ...f, vehicleId: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#01696e]">
                <option value="">Sélectionner...</option>
                {zones.map(zone => (
                  <optgroup key={zone} label={zone}>
                    {(vehiclesByZone[zone] ?? []).map(v => (
                      <option key={v.id} value={v.id}>{v.make} {v.model} — {v.licensePlate}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Type *</label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#01696e]">
                {Object.entries(BLOCKING_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Raison</label>
              <input type="text" value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#01696e]"
                placeholder="Révision 100 000 km..." />
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
              className="rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              style={{ backgroundColor: '#01696e' }}>
              {createBlocking.isPending ? 'Enregistrement...' : 'Enregistrer'}
            </button>
            <button type="button" onClick={() => setShowForm(false)}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
              Annuler
            </button>
          </div>
        </form>
      )}

      {/* Légende */}
      <div className="mb-4 flex flex-wrap items-center gap-4 text-xs text-gray-500">
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-6 rounded-sm" style={{ backgroundColor: '#01696e' }} />
          <span>Location active</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-6 rounded-sm" style={{ backgroundColor: '#01696eaa' }} />
          <span>Réservée</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-6 rounded-sm" style={{ backgroundColor: '#c2600a' }} />
          <span>🪑 Siège auto demandé</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-6 rounded-sm bg-orange-400" />
          <span>Maintenance</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-6 rounded-sm bg-red-500" />
          <span>Incident</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-6 rounded-sm opacity-50" style={{ backgroundColor: '#01696eaa' }} />
          <span>Passée</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-6 rounded-sm bg-gray-400 opacity-80" />
          <span>Indisponible Getaround</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span>📦</span><span>Accessoire</span>
        </div>
      </div>

      {/* Grille */}
      {isLoading ? (
        <div className="flex justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-t-transparent"
            style={{ borderColor: '#01696e', borderTopColor: 'transparent' }} />
        </div>
      ) : vehicles.length === 0 ? (
        <div className="py-20 text-center text-gray-400">Aucun véhicule actif</div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
          {/* En-tête des jours */}
          <div className="flex border-b border-gray-200 sticky top-0 bg-white z-20">
            <div className="w-[90px] sm:w-44 shrink-0 border-r border-gray-200 px-2 sm:px-3 py-2 text-xs font-semibold text-gray-500">
              Véhicule
            </div>
            <div className="flex flex-1 min-w-[500px]">
              {days.map(day => (
                <div key={day.toISOString()}
                  className={`flex-1 border-r border-gray-100 px-0.5 py-2 text-center text-xs leading-tight
                    ${isSameDay(day, today) ? 'bg-[#01696e]/5 font-bold text-[#01696e]' : 'text-gray-400'}`}>
                  <div className="font-medium">{format(day, 'EEE', { locale: fr })}</div>
                  <div className={`text-[11px] ${isSameDay(day, today) ? 'text-[#01696e] font-bold' : 'text-gray-400'}`}>
                    {format(day, 'd')}
                    {viewMode <= 14 && <span className="ml-0.5 opacity-60">{format(day, 'MMM', { locale: fr })}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Zones + véhicules */}
          {Object.keys(filteredVehiclesByZone).sort().map(zone => (
            <React.Fragment key={zone}>
              {/* En-tête zone */}
              <div className="flex border-b border-gray-200 sticky top-[41px] z-10">
                <div className="w-[90px] sm:w-44 shrink-0 border-r border-gray-200" />
                <div className="flex-1 min-w-[500px]">
                  <ZoneHeader zone={zone} count={filteredVehiclesByZone[zone]?.length ?? 0} />
                </div>
              </div>

              {/* Lignes véhicules */}
              {(filteredVehiclesByZone[zone] ?? []).map(v => {
                const vRentals = rentals.filter(r => r.vehicleId === v.id);
                const vBlockings = blockings.filter(b => b.vehicleId === v.id);
                const vUnavailabilities = unavailabilities.filter(u => u.vehicleId === v.id);
                return (
                  <div key={v.id} className="flex border-b border-gray-100 last:border-0 hover:bg-gray-50/50 transition-colors">
                    {/* Infos véhicule */}
                    <div className="w-[90px] sm:w-44 shrink-0 border-r border-gray-200 px-2 sm:px-3 py-2.5 flex flex-col justify-center">
                      <p className="text-xs font-semibold text-gray-800 truncate">
                        <span className="sm:hidden">{v.model}</span>
                        <span className="hidden sm:inline">{v.make} {v.model}</span>
                      </p>
                      <p className="text-[11px] text-gray-400 tracking-wide truncate">{v.licensePlate}</p>
                    </div>

                    {/* Barre timeline */}
                    <div className="relative flex-1 min-w-[500px] h-12">
                      {/* Grille verticale des jours */}
                      <div className="absolute inset-0 flex pointer-events-none">
                        {days.map(day => (
                          <div key={day.toISOString()}
                            className={`flex-1 border-r border-gray-100 ${isSameDay(day, today) ? 'bg-[#01696e]/5' : ''}`} />
                        ))}
                      </div>

                      {/* Ligne "maintenant" */}
                      {todayVisible && (
                        <div className="absolute top-0 bottom-0 w-px bg-[#01696e]/40 z-20 pointer-events-none"
                          style={{ left: `${todayPct}%` }} />
                      )}

                      {/* Barres locations */}
                      {vRentals.map(r => (
                        <RentalBar key={r.id} rental={r} periodStart={periodStart} totalDays={viewMode} onClick={() => navigate(`/rentals/${r.id}`)} isBlacklisted={!!(r.driverGetaroundId && blacklistedIds.has(r.driverGetaroundId))} />
                      ))}

                      {/* Barres blocages */}
                      {vBlockings.map(b => (
                        <BlockingBar key={b.id} blocking={b} onDelete={id => deleteBlocking.mutate(id)} periodStart={periodStart} totalDays={viewMode} />
                      ))}

                      {/* Indisponibilités Getaround */}
                      {vUnavailabilities.map(u => (
                        <UnavailabilityBar key={u.id} unavailability={u} periodStart={periodStart} totalDays={viewMode} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
