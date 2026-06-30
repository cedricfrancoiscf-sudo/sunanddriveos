import React, { useState, useEffect } from 'react';
import { trackEvent } from '../../utils/tracking';
import { Link } from 'react-router-dom';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../utils/api';
import { vehiclesApi, getaroundSyncApi, type Vehicle } from './vehiclesApi';

type RoiSignal = 'vendre_maintenant' | 'bientot' | 'optimal' | 'attendre';
const SIGNAL_BADGE: Record<string, string> = {
  vendre_maintenant: 'bg-red-100 text-red-700',
  bientot: 'bg-amber-100 text-amber-700',
  optimal: 'bg-green-100 text-green-700',
  attendre: 'bg-gray-100 text-gray-600',
};
const SIGNAL_LABEL: Record<string, string> = {
  vendre_maintenant: '⚠ Vendre',
  bientot: '→ Bientôt',
  optimal: '✓ Fenêtre',
  attendre: 'OK',
};

type FleetViewMode = 'grid' | 'list';

function getStoredViewMode(): FleetViewMode {
  const stored = localStorage.getItem('fleet_view_mode');
  return stored === 'list' ? 'list' : 'grid';
}

function HealthBadge({ score }: { score: number }): React.JSX.Element {
  const color =
    score >= 80 ? 'bg-green-100 text-green-700' :
    score >= 50 ? 'bg-yellow-100 text-yellow-700' :
    'bg-red-100 text-red-700';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
      {score}/100
    </span>
  );
}

function VehicleCard({ vehicle, signal }: { vehicle: Vehicle; signal?: RoiSignal | null }): React.JSX.Element {
  const hasGetaround = Boolean(vehicle.getaroundId);

  return (
    <Link
      to={`/vehicles/${vehicle.id}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition hover:shadow-md hover:border-[#01696e]/40"
    >
      {/* Photo */}
      <div className="relative h-36 bg-gray-100">
        {vehicle.photoUrl ? (
          <img
            src={vehicle.photoUrl}
            alt={`${vehicle.make} ${vehicle.model}`}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <svg className="h-12 w-12 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0zM13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
            </svg>
          </div>
        )}
        {hasGetaround && (
          <span className="absolute right-2 top-2 rounded-full bg-[#01696e] px-2 py-0.5 text-xs font-medium text-white">
            Getaround
          </span>
        )}
        {!vehicle.isActive && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-gray-700">Inactif</span>
          </div>
        )}
      </div>

      {/* Infos */}
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-semibold text-gray-900 group-hover:text-[#01696e] transition-colors">
              {vehicle.make} {vehicle.model}
            </p>
            <p className="text-sm text-gray-500">{vehicle.year} · {vehicle.color ?? '—'}</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <HealthBadge score={vehicle.healthScore} />
            {signal && (
              <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${SIGNAL_BADGE[signal] ?? 'bg-gray-100 text-gray-500'}`}>
                {SIGNAL_LABEL[signal] ?? signal}
              </span>
            )}
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
          <span className="rounded-md bg-gray-100 px-2 py-0.5 font-mono font-medium text-gray-700">
            {vehicle.licensePlate}
          </span>
          <span>{vehicle.currentMileage.toLocaleString('fr-FR')} km</span>
        </div>

        {vehicle.getaroundAccount && (
          <p className="mt-2 truncate text-xs text-gray-400">
            Compte : {vehicle.getaroundAccount.name}
          </p>
        )}
      </div>
    </Link>
  );
}

function SyncModal({
  onClose,
}: {
  onClose: () => void;
}): React.JSX.Element {
  const qc = useQueryClient();
  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['getaround-accounts'],
    queryFn: getaroundSyncApi.listAccounts,
  });

  const syncMutation = useMutation({
    mutationFn: (id: string) => getaroundSyncApi.syncAccount(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['vehicles'] });
      void qc.invalidateQueries({ queryKey: ['rentals'] });
      void qc.invalidateQueries({ queryKey: ['messages'] });
    },
  });

  const syncAllMutation = useMutation({
    mutationFn: getaroundSyncApi.syncAll,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['vehicles'] });
      void qc.invalidateQueries({ queryKey: ['rentals'] });
      void qc.invalidateQueries({ queryKey: ['messages'] });
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Synchronisation Getaround</h2>

        {isLoading && <p className="text-sm text-gray-500">Chargement des comptes...</p>}

        {accounts.length === 0 && !isLoading && (
          <p className="text-sm text-gray-500">Aucun compte Getaround configuré.<br />Ajoutez-en un dans Paramètres.</p>
        )}

        <div className="space-y-3">
          {accounts.map((acc) => (
            <div key={acc.id} className="flex items-center justify-between rounded-lg border border-gray-200 p-3">
              <div>
                <p className="text-sm font-medium text-gray-900">{acc.name}</p>
                <p className="text-xs text-gray-400">{acc._count.vehicles} véhicules</p>
                {acc.syncError && <p className="text-xs text-red-500">{acc.syncError}</p>}
              </div>
              <button
                type="button"
                onClick={() => syncMutation.mutate(acc.id)}
                disabled={syncMutation.isPending}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-white transition disabled:opacity-60"
                style={{ backgroundColor: '#01696e' }}
              >
                {syncMutation.isPending ? '...' : 'Sync'}
              </button>
            </div>
          ))}
        </div>

        {accounts.length > 1 && (
          <button
            type="button"
            onClick={() => syncAllMutation.mutate()}
            disabled={syncAllMutation.isPending}
            className="mt-4 w-full rounded-lg py-2 text-sm font-medium text-white transition disabled:opacity-60"
            style={{ backgroundColor: '#01696e' }}
          >
            {syncAllMutation.isPending ? 'Synchronisation...' : 'Synchroniser tous les comptes'}
          </button>
        )}

        {(syncMutation.isSuccess || syncAllMutation.isSuccess) && (
          <p className="mt-3 text-center text-sm text-green-600">Synchronisation terminée</p>
        )}

        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-lg border border-gray-200 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Fermer
        </button>
      </div>
    </div>
  );
}

function VehicleTableRow({ vehicle, signal }: { vehicle: Vehicle; signal?: RoiSignal | null }): React.JSX.Element {
  const statusLabel = vehicle.isActive ? 'Actif' : 'Inactif';
  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
      <td className="px-4 py-3 font-mono text-sm font-medium text-gray-700">{vehicle.licensePlate}</td>
      <td className="px-4 py-3">
        <div>
          <span className="font-medium text-gray-900">{vehicle.make} {vehicle.model}</span>
          {vehicle.getaroundAccount && (
            <span className="ml-2 text-xs text-gray-400">{vehicle.getaroundAccount.name}</span>
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-sm text-gray-600">{vehicle.year}</td>
      <td className="px-4 py-3 text-sm text-gray-600">{vehicle.currentMileage.toLocaleString('fr-FR')} km</td>
      <td className="px-4 py-3">
        <HealthBadge score={vehicle.healthScore} />
      </td>
      <td className="px-4 py-3">
        {signal ? (
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${SIGNAL_BADGE[signal] ?? 'bg-gray-100 text-gray-500'}`}>
            {SIGNAL_LABEL[signal] ?? signal}
          </span>
        ) : (
          <span className="text-xs text-gray-300">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${vehicle.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
          {statusLabel}
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        <Link
          to={`/vehicles/${vehicle.id}`}
          className="mr-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
        >
          Voir
        </Link>
        <Link
          to={`/vehicles/${vehicle.id}/edit`}
          className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
        >
          Modifier
        </Link>
      </td>
    </tr>
  );
}

type VehicleSortKey = 'licensePlate' | 'make' | 'year' | 'currentMileage';

export default function VehicleListPage(): React.JSX.Element {
  const [showSync, setShowSync] = useState(false);
  const [search, setSearch] = useState('');
  const [fleetView, setFleetView] = useState<FleetViewMode>(getStoredViewMode);
  const [sortKey, setSortKey] = useState<VehicleSortKey>('licensePlate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  useEffect(() => { void trackEvent('vehicles', 'view'); }, []);

  const [collapsedDeliveryPoints, setCollapsedDeliveryPoints] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('flotte-collapsed-delivery-points');
      return saved ? new Set(JSON.parse(saved) as string[]) : new Set<string>();
    } catch { return new Set<string>(); }
  });
  useEffect(() => {
    localStorage.setItem('flotte-collapsed-delivery-points', JSON.stringify([...collapsedDeliveryPoints]));
  }, [collapsedDeliveryPoints]);

  function toggleDeliveryPoint(key: string): void {
    setCollapsedDeliveryPoints(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleVehicleSort(k: VehicleSortKey) {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('asc'); }
  }

  function SortVehicleTh({ k, label }: { k: VehicleSortKey; label: string }): React.JSX.Element {
    const active = sortKey === k;
    return (
      <th className={`px-4 py-3 text-xs font-semibold uppercase tracking-wide cursor-pointer select-none hover:text-gray-800 transition-colors ${active ? 'text-[#01696e]' : 'text-gray-500'}`}
        onClick={() => toggleVehicleSort(k)}>
        {label}{active ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ' ↕'}
      </th>
    );
  }
  function toggleView(mode: FleetViewMode): void {
    setFleetView(mode);
    localStorage.setItem('fleet_view_mode', mode);
  }

  const { data: vehicles = [], isLoading, isError } = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => vehiclesApi.list(),
    staleTime: 5 * 60_000,
  });

  const roiResults = useQueries({
    queries: vehicles.map(v => ({
      queryKey: ['roi-analysis', v.id],
      queryFn: () => api.get<{ analysis?: { signal?: RoiSignal } }>(`/vehicles/${v.id}/roi-analysis`).then(r => r.data.analysis?.signal ?? null),
      staleTime: 10 * 60_000,
      enabled: Boolean(v.id),
    })),
  });
  const signalByVehicleId = new Map<string, RoiSignal | null>(
    vehicles.map((v, i) => [v.id, (roiResults[i]?.data ?? null) as RoiSignal | null])
  );

  const filtered = vehicles
    .filter((v) => {
      const q = search.toLowerCase();
      return (
        v.licensePlate.toLowerCase().includes(q) ||
        v.make.toLowerCase().includes(q) ||
        v.model.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'licensePlate') cmp = a.licensePlate.localeCompare(b.licensePlate, 'fr');
      else if (sortKey === 'make') cmp = `${a.make} ${a.model}`.localeCompare(`${b.make} ${b.model}`, 'fr');
      else if (sortKey === 'year') cmp = (a.year ?? 0) - (b.year ?? 0);
      else if (sortKey === 'currentMileage') cmp = a.currentMileage - b.currentMileage;
      return sortDir === 'desc' ? -cmp : cmp;
    });

  return (
    <div className="p-4 lg:p-6">
      {/* En-tête */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Flotte</h1>
          <p className="text-sm text-gray-500">{vehicles.length} véhicule{vehicles.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Toggle vignettes / liste */}
          <div className="flex rounded-lg border border-gray-200 bg-white overflow-hidden">
            <button
              type="button"
              title="Vue vignettes"
              onClick={() => toggleView('grid')}
              className={`flex items-center px-2.5 py-2 transition ${fleetView === 'grid' ? 'text-white' : 'text-gray-400 hover:text-gray-700'}`}
              style={fleetView === 'grid' ? { backgroundColor: '#01696e' } : undefined}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
            </button>
            <button
              type="button"
              title="Vue liste"
              onClick={() => toggleView('list')}
              className={`flex items-center px-2.5 py-2 transition border-l border-gray-200 ${fleetView === 'list' ? 'text-white' : 'text-gray-400 hover:text-gray-700'}`}
              style={fleetView === 'list' ? { backgroundColor: '#01696e' } : undefined}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
              </svg>
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowSync(true)}
            className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Sync Getaround
          </button>
          <Link
            to="/vehicles/new"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white shadow-sm transition"
            style={{ backgroundColor: '#01696e' }}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Ajouter
          </Link>
        </div>
      </div>

      {/* Recherche */}
      <div className="mb-4 relative">
        <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          placeholder="Rechercher par immatriculation, marque, modèle..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-4 text-sm outline-none focus:border-[#01696e] focus:ring-2 focus:ring-[#01696e]/20"
        />
      </div>

      {/* États */}
      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="animate-pulse rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="h-4 w-3/4 rounded bg-gray-100 mb-3" />
              <div className="h-3 w-1/2 rounded bg-gray-100 mb-2" />
              <div className="h-3 w-1/3 rounded bg-gray-100" />
            </div>
          ))}
        </div>
      )}

      {isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Erreur lors du chargement de la flotte.
        </div>
      )}

      {!isLoading && !isError && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <svg className="mb-4 h-12 w-12 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          <p className="font-medium text-gray-600">Aucun véhicule</p>
          <p className="mt-1 text-sm text-gray-400">
            {search ? 'Aucun résultat pour cette recherche.' : 'Ajoutez un véhicule ou synchronisez Getaround.'}
          </p>
        </div>
      )}

      {/* Vignettes */}
      {!isLoading && filtered.length > 0 && fleetView === 'grid' && (() => {
        const groups = new Map<string, typeof filtered>();
        for (const v of filtered) {
          const key = v.deliveryPointName ?? '';
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(v);
        }
        const sorted = [...groups.entries()].sort(([a], [b]) => {
          if (!a) return 1;
          if (!b) return -1;
          return a.localeCompare(b);
        });
        const allCollapsed = sorted.every(([k]) => collapsedDeliveryPoints.has(k || '_none'));
        return (
          <div className="space-y-4">
            {sorted.length >= 3 && (
              <div className="flex justify-end">
                <button type="button"
                  onClick={() => allCollapsed
                    ? setCollapsedDeliveryPoints(new Set())
                    : setCollapsedDeliveryPoints(new Set(sorted.map(([k]) => k || '_none')))
                  }
                  className="text-xs text-gray-500 hover:text-gray-700 transition-colors">
                  {allCollapsed ? 'Tout déplier' : 'Tout replier'}
                </button>
              </div>
            )}
            {sorted.map(([point, list]) => {
              const key = point || '_none';
              const isCollapsed = collapsedDeliveryPoints.has(key);
              const avgHealth = list.length > 0 ? Math.round(list.reduce((s, v) => s + v.healthScore, 0) / list.length) : 0;
              const activeCount = list.filter(v => v.isActive).length;
              return (
                <div key={key}>
                  <button type="button" onClick={() => toggleDeliveryPoint(key)}
                    className="mb-2 flex w-full items-center gap-1.5 text-left group">
                    <svg className={`h-3.5 w-3.5 text-gray-400 transition-transform shrink-0 ${isCollapsed ? '' : 'rotate-90'}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 group-hover:text-gray-600">
                      {point || 'Non assigné'}
                    </p>
                    <span className="ml-1 rounded-full bg-gray-100 px-1.5 text-[10px] font-medium text-gray-500">{list.length}</span>
                    {isCollapsed && (
                      <span className="ml-auto text-[10px] text-gray-400">
                        {activeCount} actif{activeCount !== 1 ? 's' : ''} · santé moy. {avgHealth}
                      </span>
                    )}
                  </button>
                  {!isCollapsed && (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {list.map((v) => <VehicleCard key={v.id} vehicle={v} signal={signalByVehicleId.get(v.id)} />)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Liste (tableau) */}
      {!isLoading && filtered.length > 0 && fleetView === 'list' && (() => {
        const groups = new Map<string, typeof filtered>();
        for (const v of filtered) {
          const key = v.deliveryPointName ?? '';
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(v);
        }
        const sorted = [...groups.entries()].sort(([a], [b]) => {
          if (!a) return 1;
          if (!b) return -1;
          return a.localeCompare(b);
        });
        const allCollapsed = sorted.every(([k]) => collapsedDeliveryPoints.has(k || '_none'));
        return (
          <div className="space-y-4">
            {sorted.length >= 3 && (
              <div className="flex justify-end">
                <button type="button"
                  onClick={() => allCollapsed
                    ? setCollapsedDeliveryPoints(new Set())
                    : setCollapsedDeliveryPoints(new Set(sorted.map(([k]) => k || '_none')))
                  }
                  className="text-xs text-gray-500 hover:text-gray-700 transition-colors">
                  {allCollapsed ? 'Tout déplier' : 'Tout replier'}
                </button>
              </div>
            )}
            {sorted.map(([point, list]) => {
              const key = point || '_none';
              const isCollapsed = collapsedDeliveryPoints.has(key);
              const avgHealth = list.length > 0 ? Math.round(list.reduce((s, v) => s + v.healthScore, 0) / list.length) : 0;
              const activeCount = list.filter(v => v.isActive).length;
              return (
                <div key={key}>
                  <button type="button" onClick={() => toggleDeliveryPoint(key)}
                    className="mb-1 flex w-full items-center gap-1.5 text-left group">
                    <svg className={`h-3.5 w-3.5 text-gray-400 transition-transform shrink-0 ${isCollapsed ? '' : 'rotate-90'}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 group-hover:text-gray-600">
                      {point || 'Non assigné'}
                    </p>
                    <span className="ml-1 rounded-full bg-gray-100 px-1.5 text-[10px] font-medium text-gray-500">{list.length}</span>
                    {isCollapsed && (
                      <span className="ml-auto text-[10px] text-gray-400">
                        {activeCount} actif{activeCount !== 1 ? 's' : ''} · santé moy. {avgHealth}
                      </span>
                    )}
                  </button>
                  {!isCollapsed && (
                    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                      <table className="w-full text-left">
                        <thead className="border-b border-gray-200 bg-gray-50">
                          <tr>
                            <SortVehicleTh k="licensePlate" label="Immatriculation" />
                            <SortVehicleTh k="make" label="Marque / Modèle" />
                            <SortVehicleTh k="year" label="Année" />
                            <SortVehicleTh k="currentMileage" label="Kilométrage" />
                            <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Santé</th>
                            <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Signal</th>
                            <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Statut</th>
                            <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {list.map((v) => <VehicleTableRow key={v.id} vehicle={v} signal={signalByVehicleId.get(v.id)} />)}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}

      {showSync && <SyncModal onClose={() => setShowSync(false)} />}
    </div>
  );
}
