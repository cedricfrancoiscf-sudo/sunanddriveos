import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vehiclesApi, getaroundSyncApi, type Vehicle } from './vehiclesApi';

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

function VehicleCard({ vehicle }: { vehicle: Vehicle }): React.JSX.Element {
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
          <HealthBadge score={vehicle.healthScore} />
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

export default function VehicleListPage(): React.JSX.Element {
  const [showSync, setShowSync] = useState(false);
  const [search, setSearch] = useState('');

  const { data: vehicles = [], isLoading, isError } = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => vehiclesApi.list(),
  });

  const filtered = vehicles.filter((v) => {
    const q = search.toLowerCase();
    return (
      v.licensePlate.toLowerCase().includes(q) ||
      v.make.toLowerCase().includes(q) ||
      v.model.toLowerCase().includes(q)
    );
  });

  return (
    <div className="p-4 lg:p-6">
      {/* En-tête */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Flotte</h1>
          <p className="text-sm text-gray-500">{vehicles.length} véhicule{vehicles.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex gap-2">
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
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" style={{ borderColor: '#01696e', borderTopColor: 'transparent' }} />
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

      {/* Grille */}
      {!isLoading && filtered.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((v) => (
            <VehicleCard key={v.id} vehicle={v} />
          ))}
        </div>
      )}

      {showSync && <SyncModal onClose={() => setShowSync(false)} />}
    </div>
  );
}
