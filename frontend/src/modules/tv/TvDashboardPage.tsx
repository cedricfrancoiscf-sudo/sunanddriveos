import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, differenceInHours, isPast } from 'date-fns';
import { fr } from 'date-fns/locale';
import { api } from '../../utils/api';

interface ActiveRental {
  id: string; driverName: string; startAt: string; endAt: string;
  vehicle: { make: string; model: string; licensePlate: string; photoUrl: string | null };
}
interface Vehicle {
  id: string; make: string; model: string; licensePlate: string; healthScore: number; photoUrl: string | null;
}
interface Blocking {
  id: string; vehicleId: string; startAt: string; endAt: string; type: string; reason: string | null;
  vehicle: { id: string; make: string; model: string; licensePlate: string };
}

const REFETCH_INTERVAL = 60_000;

function HealthDot({ score }: { score: number }): React.JSX.Element {
  const color = score >= 80 ? 'bg-green-400' : score >= 50 ? 'bg-yellow-400' : 'bg-red-400';
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} />;
}

export default function TvDashboardPage(): React.JSX.Element {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const { data: activeRentals = [] } = useQuery({
    queryKey: ['tv-active-rentals'],
    queryFn: () => api.get<{ rentals: ActiveRental[] }>('/rentals', { params: { status: 'active', limit: 20 } }).then(r => r.data.rentals),
    refetchInterval: REFETCH_INTERVAL,
  });

  const { data: vehiclesData } = useQuery({
    queryKey: ['tv-vehicles'],
    queryFn: () => api.get<{ vehicles: Vehicle[] }>('/vehicles').then(r => r.data.vehicles),
    refetchInterval: REFETCH_INTERVAL,
  });

  const { data: bookedRentals = [] } = useQuery({
    queryKey: ['tv-booked-rentals'],
    queryFn: () => api.get<{ rentals: ActiveRental[] }>('/rentals', { params: { status: 'booked', limit: 10 } }).then(r => r.data.rentals),
    refetchInterval: REFETCH_INTERVAL,
  });

  const { data: blockings = [] } = useQuery({
    queryKey: ['tv-blockings'],
    queryFn: () => api.get<{ blockings: Blocking[] }>('/blockings').then(r => r.data.blockings),
    refetchInterval: REFETCH_INTERVAL,
  });

  const vehicles = vehiclesData ?? [];
  const activeVehicleIds = new Set(activeRentals.map(r => r.vehicle.licensePlate));
  // Blocages actifs en ce moment
  const activeBlockings = blockings.filter(b => new Date(b.startAt) <= now && new Date(b.endAt) >= now);
  const blockedVehicleIds = new Set(activeBlockings.map(b => b.vehicleId));
  const availableVehicles = vehicles.filter(v => !activeVehicleIds.has(v.licensePlate) && !blockedVehicleIds.has(v.id));

  const returningToday = activeRentals.filter(r => {
    const end = new Date(r.endAt);
    return end.toDateString() === now.toDateString();
  });

  const startingToday = bookedRentals.filter(r => {
    const start = new Date(r.startAt);
    return start.toDateString() === now.toDateString();
  });

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: '#01696e' }}>
            <span className="text-lg font-bold">S</span>
          </div>
          <div>
            <h1 className="text-2xl font-bold">SunanddriveOS</h1>
            <p className="text-sm text-gray-400">{format(now, "EEEE d MMMM yyyy — HH:mm", { locale: fr })}</p>
          </div>
        </div>
        <div className="flex items-center gap-6 text-right">
          <div>
            <p className="text-3xl font-bold text-[#01696e]">{activeRentals.length}</p>
            <p className="text-xs text-gray-400">En cours</p>
          </div>
          <div>
            <p className="text-3xl font-bold text-gray-300">{availableVehicles.length}</p>
            <p className="text-xs text-gray-400">Disponibles</p>
          </div>
          <div>
            <p className="text-3xl font-bold text-orange-400">{returningToday.length}</p>
            <p className="text-xs text-gray-400">Retours aujourd'hui</p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Locations en cours */}
        <div className="lg:col-span-2">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Locations en cours</h2>
          {activeRentals.length === 0 ? (
            <div className="rounded-2xl border border-gray-800 bg-gray-900 p-8 text-center text-gray-500">
              Aucune location active
            </div>
          ) : (
            <div className="space-y-2">
              {activeRentals.map(r => {
                const hoursLeft = differenceInHours(new Date(r.endAt), now);
                const isLate = isPast(new Date(r.endAt));
                const isReturningToday = new Date(r.endAt).toDateString() === now.toDateString();
                return (
                  <div key={r.id} className={`flex items-center gap-4 rounded-xl border p-4 ${
                    isLate ? 'border-red-800 bg-red-950' :
                    isReturningToday ? 'border-orange-800 bg-orange-950' :
                    'border-gray-800 bg-gray-900'
                  }`}>
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#01696e]/20">
                      <svg className="h-5 w-5 text-[#01696e]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0zM13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-white">{r.driverName}</p>
                      <p className="text-sm text-gray-400">{r.vehicle.make} {r.vehicle.model} · <span className="font-mono text-gray-300">{r.vehicle.licensePlate}</span></p>
                    </div>
                    <div className="shrink-0 text-right">
                      {isLate ? (
                        <p className="text-sm font-bold text-red-400">En retard</p>
                      ) : isReturningToday ? (
                        <p className="text-sm font-bold text-orange-400">
                          Retour {hoursLeft <= 0 ? 'maintenant' : `dans ${hoursLeft}h`}
                        </p>
                      ) : (
                        <p className="text-sm text-gray-400">jusqu'au</p>
                      )}
                      <p className="text-xs text-gray-500">{format(new Date(r.endAt), 'dd/MM HH:mm', { locale: fr })}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Départs aujourd'hui */}
          {startingToday.length > 0 && (
            <div className="mt-6">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Départs aujourd'hui</h2>
              <div className="space-y-2">
                {startingToday.map(r => (
                  <div key={r.id} className="flex items-center gap-4 rounded-xl border border-blue-900 bg-blue-950 p-3">
                    <div className="flex-1">
                      <p className="font-medium text-white">{r.driverName}</p>
                      <p className="text-sm text-gray-400">{r.vehicle.make} {r.vehicle.model} · <span className="font-mono">{r.vehicle.licensePlate}</span></p>
                    </div>
                    <p className="text-sm font-semibold text-blue-300">{format(new Date(r.startAt), 'HH:mm', { locale: fr })}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Flotte disponible */}
        <div>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Véhicules disponibles</h2>
          {availableVehicles.length === 0 ? (
            <div className="rounded-xl border border-gray-800 bg-gray-900 p-6 text-center text-sm text-gray-500">
              Tous les véhicules sont loués
            </div>
          ) : (
            <div className="space-y-2">
              {availableVehicles.map(v => (
                <div key={v.id} className="flex items-center gap-3 rounded-xl border border-gray-800 bg-gray-900 p-3">
                  <HealthDot score={v.healthScore} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white">{v.make} {v.model}</p>
                    <p className="font-mono text-xs text-gray-400">{v.licensePlate}</p>
                  </div>
                  <span className="text-xs text-gray-500">{v.healthScore}%</span>
                </div>
              ))}
            </div>
          )}

          {/* Blocages actifs */}
          {activeBlockings.length > 0 && (
            <div className="mt-6">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Bloqués</h2>
              <div className="space-y-2">
                {activeBlockings.map(b => (
                  <div key={b.id} className="flex items-center gap-3 rounded-xl border border-orange-900 bg-orange-950 p-3">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-orange-400" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white">{b.vehicle.make} {b.vehicle.model}</p>
                      <p className="font-mono text-xs text-gray-400">{b.vehicle.licensePlate}</p>
                      {b.reason && <p className="text-xs text-orange-400">{b.reason}</p>}
                    </div>
                    <p className="text-xs text-gray-500 shrink-0">
                      jusqu'au {format(new Date(b.endAt), 'dd/MM HH:mm', { locale: fr })}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Indicateur rafraîchissement */}
          <p className="mt-6 text-center text-xs text-gray-700">
            Actualisation automatique toutes les 60s
          </p>
        </div>
      </div>
    </div>
  );
}
