import React, { useState, useMemo, useEffect } from 'react';
import { trackEvent } from '../../utils/tracking';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format, differenceInDays, startOfMonth, endOfMonth, addMonths, subMonths } from 'date-fns';
import { fr } from 'date-fns/locale';
import { rentalsApi, type RentalStatus, type Rental } from './rentalsApi';

const STATUS_LABELS: Record<RentalStatus, string> = {
  booked: 'Réservée',
  active: 'En cours',
  completed: 'Terminée',
  cancelled: 'Annulée',
};

const STATUS_COLORS: Record<RentalStatus, string> = {
  booked: 'bg-blue-100 text-blue-700',
  active: 'bg-green-100 text-green-700',
  completed: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-red-100 text-red-600',
};

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }): React.JSX.Element {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

function RentalRow({ rental }: { rental: Rental }): React.JSX.Element {
  const duration = differenceInDays(new Date(rental.endAt), new Date(rental.startAt));

  return (
    <Link
      to={`/rentals/${rental.id}`}
      className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm transition hover:border-[#01696e]/40 hover:shadow-md"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-900">
            {rental.vehicle.make} {rental.vehicle.model}
          </span>
          <span className="font-mono text-xs text-gray-400">{rental.vehicle.licensePlate}</span>
        </div>
        <p className="mt-0.5 text-sm text-gray-500">{rental.driverName}</p>
      </div>

      <div className="hidden text-right sm:block">
        <p className="text-sm font-medium text-gray-700">
          {format(new Date(rental.startAt), 'dd MMM', { locale: fr })} →{' '}
          {format(new Date(rental.endAt), 'dd MMM yyyy', { locale: fr })}
        </p>
        <p className="text-xs text-gray-400">{duration} jour{duration !== 1 ? 's' : ''}</p>
      </div>

      <div className="hidden text-right md:block w-24">
        {rental.grossRevenue != null ? (
          <>
            <p className="text-sm font-semibold text-gray-900">
              {rental.grossRevenue.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
            </p>
            {rental.ownerPayout != null && (
              <p className="text-xs text-gray-400">
                {rental.ownerPayout.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
              </p>
            )}
          </>
        ) : (
          <span className="text-xs text-gray-300">—</span>
        )}
      </div>

      <div className="hidden text-right lg:block w-20">
        {rental.kmDriven != null ? (
          <p className="text-sm text-gray-700">{rental.kmDriven.toLocaleString('fr-FR')} km</p>
        ) : (
          <span className="text-xs text-gray-300">—</span>
        )}
      </div>

      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_COLORS[rental.status]}`}>
        {STATUS_LABELS[rental.status]}
      </span>
    </Link>
  );
}

export default function RentalListPage(): React.JSX.Element {
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()));
  const [search, setSearch] = useState('');
  useEffect(() => { void trackEvent('rentals', 'view'); }, []);

  const { data: statsData } = useQuery({
    queryKey: ['rental-stats'],
    queryFn: rentalsApi.stats,
    staleTime: 2 * 60_000,
  });

  const { data, isLoading, isError } = useQuery({
    queryKey: ['rentals'],
    queryFn: () => rentalsApi.list({ limit: 500 }),
    staleTime: 2 * 60_000,
  });

  const rentals = data?.rentals ?? [];

  const monthStart = currentMonth;
  const monthEnd = endOfMonth(currentMonth);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return rentals.filter((r) => {
      const start = new Date(r.startAt);
      const end = new Date(r.endAt);
      const inMonth = start <= monthEnd && end >= monthStart;
      if (!inMonth) return false;
      if (!q) return true;
      return (
        r.driverName.toLowerCase().includes(q) ||
        r.vehicle.licensePlate.toLowerCase().includes(q) ||
        r.vehicle.make.toLowerCase().includes(q) ||
        r.vehicle.model.toLowerCase().includes(q)
      );
    });
  }, [rentals, monthStart, monthEnd, search]);

  const monthRevenue = useMemo(
    () => filtered.reduce((sum, r) => sum + (r.grossRevenue ?? 0), 0),
    [filtered],
  );

  const stats = statsData?.stats;
  const monthLabel = format(currentMonth, 'MMMM yyyy', { locale: fr });

  return (
    <div className="p-4 lg:p-6">
      {/* En-tête */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Locations</h1>
          <p className="text-sm text-gray-500">{data?.total ?? 0} location{(data?.total ?? 0) !== 1 ? 's' : ''} au total</p>
        </div>
      </div>

      {/* KPIs du mois */}
      {stats && (
        <div className="mb-6 grid gap-3 grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="CA du mois"
            value={stats.totalRevenue.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
            sub={`Virement : ${stats.totalPayout.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}`}
          />
          <StatCard
            label="Taux d'occupation"
            value={`${stats.occupancyRate} %`}
            sub={`${stats.vehicleCount} véhicule${stats.vehicleCount !== 1 ? 's' : ''}`}
          />
          <StatCard
            label="Locations"
            value={String(stats.rentalCount)}
            sub="ce mois-ci"
          />
          <StatCard
            label="Km parcourus"
            value={stats.totalKm.toLocaleString('fr-FR')}
            sub="ce mois-ci"
          />
        </div>
      )}

      {/* Sélecteur de mois */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2">
          <button
            type="button"
            onClick={() => setCurrentMonth(m => subMonths(m, 1))}
            className="rounded p-1 text-gray-400 hover:text-gray-700"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="min-w-[120px] text-center text-sm font-semibold capitalize text-gray-900">
            {monthLabel}
          </span>
          <button
            type="button"
            onClick={() => setCurrentMonth(m => addMonths(m, 1))}
            className="rounded p-1 text-gray-400 hover:text-gray-700"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        <div className="relative flex-1 min-w-[180px]">
          <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Rechercher par locataire, véhicule..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-4 text-sm outline-none focus:border-[#01696e] focus:ring-2 focus:ring-[#01696e]/20"
          />
        </div>
      </div>

      {/* États */}
      {isLoading && (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" style={{ borderColor: '#01696e', borderTopColor: 'transparent' }} />
        </div>
      )}

      {isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Erreur lors du chargement des locations.
        </div>
      )}

      {!isLoading && !isError && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="font-medium text-gray-500">Aucune location en {monthLabel}</p>
          <p className="mt-1 text-sm text-gray-400">Naviguez vers un autre mois ou synchronisez Getaround.</p>
        </div>
      )}

      {!isLoading && filtered.length > 0 && (
        <>
          {/* Sous-total mois */}
          <div className="mb-3 flex items-center justify-between rounded-xl border border-[#01696e]/20 bg-[#01696e]/5 px-4 py-2.5">
            <span className="text-sm font-medium capitalize text-gray-700">{monthLabel}</span>
            <div className="flex items-center gap-4 text-sm">
              <span className="text-gray-500">{filtered.length} location{filtered.length !== 1 ? 's' : ''}</span>
              <span className="font-semibold text-gray-900">
                CA : {monthRevenue.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            {filtered.map((r) => (
              <RentalRow key={r.id} rental={r} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
