import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, differenceInDays, isPast } from 'date-fns';
import { fr } from 'date-fns/locale';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../../utils/api';
import { useAuth } from '../../hooks/useAuth';

interface RentalStats { totalRevenue: number; occupancyRate: number; rentalCount: number; totalKm: number; vehicleCount: number; totalPayout: number; }
interface ActiveRental { id: string; driverName: string; startAt: string; endAt: string; vehicle: { make: string; model: string; licensePlate: string }; }
interface Alert { id: string; type: string; label: string; severity: 'high' | 'medium'; link: string; }

function KpiCard({ label, value, sub, link }: { label: string; value: string; sub?: string | undefined; link?: string | undefined }): React.JSX.Element {
  const inner = (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm h-full">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-2 text-3xl font-bold text-gray-900">{value}</p>
      {sub && <p className="mt-1 text-xs text-gray-400">{sub}</p>}
    </div>
  );
  return link ? <Link to={link} className="block hover:opacity-90 transition">{inner}</Link> : <div>{inner}</div>;
}

function AlertCard({ alert }: { alert: Alert }): React.JSX.Element {
  return (
    <Link to={alert.link}
      className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition hover:shadow-md ${alert.severity === 'high' ? 'border-red-200 bg-red-50' : 'border-orange-200 bg-orange-50'}`}>
      <div className={`h-2 w-2 shrink-0 rounded-full ${alert.severity === 'high' ? 'bg-red-500' : 'bg-orange-400'}`} />
      <p className={`text-sm font-medium ${alert.severity === 'high' ? 'text-red-800' : 'text-orange-800'}`}>{alert.label}</p>
      <svg className="ml-auto h-4 w-4 shrink-0 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  );
}

export default function DashboardPage(): React.JSX.Element {
  const { user } = useAuth();

  const { data: statsData } = useQuery({
    queryKey: ['rental-stats'],
    queryFn: () => api.get<{ stats: RentalStats }>('/rentals/stats').then(r => r.data.stats),
  });

  const { data: activeRentals = [] } = useQuery({
    queryKey: ['rentals', 'active'],
    queryFn: () => api.get<{ rentals: ActiveRental[] }>('/rentals', { params: { status: 'active', limit: 5 } }).then(r => r.data.rentals),
  });

  const { data: pendingMessages } = useQuery({
    queryKey: ['inbox-summary'],
    queryFn: () => api.get<{ pendingCount: number; unansweredRentals: number }>('/messages/inbox-summary').then(r => r.data),
    refetchInterval: 30_000,
  });

  const { data: expiringCT = [] } = useQuery({
    queryKey: ['ct-expiring'],
    queryFn: () => api.get<{ controls: Array<{ id: string; expiryAt: string; vehicle: { make: string; model: string; licensePlate: string } }> }>('/technical-control/expiring').then(r => r.data.controls),
  });

  const { data: expiringDocs = [] } = useQuery({
    queryKey: ['docs-expiring'],
    queryFn: () => api.get<{ documents: Array<{ id: string; name: string; expiryDate: string; vehicle: { make: string; model: string; licensePlate: string } }> }>('/documents/expiring').then(r => r.data.documents),
  });

  const { data: pendingCarSeats = [] } = useQuery({
    queryKey: ['car-seat-requests', 'pending'],
    queryFn: () => api.get<{ requests: Array<{ id: string; rental: { id: string; driverName: string } | null; vehicle: { make: string; model: string; licensePlate: string } }> }>('/car-seat-requests', { params: { status: 'pending' } }).then(r => r.data.requests),
  });

  const { data: cashflowForecast = [] } = useQuery({
    queryKey: ['cashflow-forecast'],
    queryFn: () => api.get<{ forecast: Array<{ week: string; weekStart: string; expectedRevenue: number; rentalCount: number }> }>('/ai/cashflow-forecast').then(r => r.data.forecast),
    staleTime: 5 * 60_000,
    enabled: user?.role !== 'carkeeper',
  });

  // Construire les alertes
  const alerts: Alert[] = [
    ...(pendingMessages && pendingMessages.pendingCount > 0 ? [{
      id: 'msg', type: 'message', severity: 'medium' as const,
      label: `${pendingMessages.pendingCount} message${pendingMessages.pendingCount > 1 ? 's' : ''} en attente d'approbation`,
      link: '/messages?status=pending_approval',
    }] : []),
    ...expiringCT.slice(0, 3).map(c => ({
      id: `ct-${c.id}`, type: 'ct',
      severity: isPast(new Date(c.expiryAt)) ? 'high' as const : 'medium' as const,
      label: `CT ${c.vehicle.make} ${c.vehicle.model} (${c.vehicle.licensePlate}) — ${isPast(new Date(c.expiryAt)) ? 'expiré' : `expire le ${format(new Date(c.expiryAt), 'dd/MM/yy', { locale: fr })}`}`,
      link: '/technical-control',
    })),
    ...expiringDocs.slice(0, 2).map(d => ({
      id: `doc-${d.id}`, type: 'doc', severity: 'medium' as const,
      label: `Document "${d.name}" — ${d.vehicle.make} ${d.vehicle.model} expire le ${format(new Date(d.expiryDate), 'dd/MM/yy', { locale: fr })}`,
      link: '/documents',
    })),
    ...pendingCarSeats.slice(0, 2).map(r => ({
      id: `csr-${r.id}`, type: 'car_seat', severity: 'medium' as const,
      label: `Siège auto demandé — ${r.vehicle.make} ${r.vehicle.model} (${r.vehicle.licensePlate})${r.rental ? ` · ${r.rental.driverName}` : ''}`,
      link: r.rental ? `/messages?rentalId=${r.rental.id}` : '/messages',
    })),
  ];

  const stats = statsData;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir';

  const qc = useQueryClient();
  const { data: onboarding } = useQuery({
    queryKey: ['onboarding-progress'],
    queryFn: () => api.get<{ progressPercent: number; completedCount: number; totalCount: number; allDone: boolean; dismissed: boolean }>('/onboarding/progress').then(r => r.data),
  });
  const dismissOnboarding = useMutation({
    mutationFn: () => api.post('/onboarding/dismiss'),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['onboarding-progress'] }),
  });
  const showOnboardingBanner = onboarding && !onboarding.dismissed && !onboarding.allDone;

  return (
    <div className="p-4 lg:p-6 space-y-6">
      {/* Bannière onboarding */}
      {showOnboardingBanner && (
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-[#01696e]/20 bg-[#01696e]/5 px-5 py-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="relative h-10 w-10 shrink-0">
              <svg className="h-10 w-10 -rotate-90" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="#e5e7eb" strokeWidth="3" />
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="#01696e" strokeWidth="3"
                  strokeDasharray={`${onboarding.progressPercent} 100`} strokeLinecap="round" />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-[#01696e]">
                {onboarding.progressPercent}%
              </span>
            </div>
            <div>
              <p className="font-semibold text-gray-900 text-sm">Configurez votre espace</p>
              <p className="text-xs text-gray-500">{onboarding.completedCount}/{onboarding.totalCount} étapes complétées</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link to="/onboarding"
              className="rounded-xl px-3 py-1.5 text-xs font-medium text-white"
              style={{ backgroundColor: '#01696e' }}>
              Continuer →
            </Link>
            <button type="button" onClick={() => dismissOnboarding.mutate()}
              className="rounded-lg p-1.5 text-gray-400 hover:text-gray-600" title="Masquer">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Accueil */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{greeting}, {user?.name?.split(' ')[0]} 👋</h1>
        <p className="text-sm text-gray-500">{format(new Date(), "EEEE d MMMM yyyy", { locale: fr })}</p>
      </div>

      {/* KPIs du mois — masqués pour les carkeepers */}
      {user?.role !== 'carkeeper' && (
        <div>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Ce mois-ci</h2>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Chiffre d'affaires"
              value={stats ? stats.totalRevenue.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }) : '—'}
              sub={stats ? `Virement : ${stats.totalPayout.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}` : undefined}
              link="/rentals"
            />
            <KpiCard
              label="Taux d'occupation"
              value={stats ? `${stats.occupancyRate} %` : '—'}
              sub={stats ? `${stats.vehicleCount} véhicule${stats.vehicleCount !== 1 ? 's' : ''}` : undefined}
              link="/vehicles"
            />
            <KpiCard
              label="Locations"
              value={stats ? String(stats.rentalCount) : '—'}
              sub="ce mois"
              link="/rentals"
            />
            <KpiCard
              label="Km parcourus"
              value={stats ? stats.totalKm.toLocaleString('fr-FR') : '—'}
              sub="ce mois"
            />
          </div>
        </div>
      )}

      {/* Prévision trésorerie 30 jours */}
      {user?.role !== 'carkeeper' && cashflowForecast.length > 0 && (
        <div>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Prévision 30 jours</h2>
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="mb-2 flex items-center justify-between text-xs text-gray-400">
              <span>{cashflowForecast.reduce((s, w) => s + w.rentalCount, 0)} locations réservées</span>
              <span className="font-semibold text-gray-700">
                {cashflowForecast.reduce((s, w) => s + w.expectedRevenue, 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })} estimés
              </span>
            </div>
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={cashflowForecast} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(v: number) => [v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }), 'CA prévu']}
                  labelFormatter={(l: string) => l}
                />
                <Bar dataKey="expectedRevenue" fill="#01696e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Locations en cours */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Locations en cours</h2>
            <Link to="/rentals?status=active" className="text-xs text-[#01696e] hover:underline">Voir toutes →</Link>
          </div>
          {activeRentals.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-400 text-center">Aucune location active</div>
          ) : (
            <div className="space-y-2">
              {activeRentals.map(r => {
                const daysLeft = differenceInDays(new Date(r.endAt), new Date());
                return (
                  <Link key={r.id} to={`/rentals/${r.id}`}
                    className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm transition hover:border-[#01696e]/40">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{r.driverName}</p>
                      <p className="text-xs text-gray-500">{r.vehicle.make} {r.vehicle.model} · <span className="font-mono">{r.vehicle.licensePlate}</span></p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-400">jusqu'au</p>
                      <p className="text-sm font-medium text-gray-700">{format(new Date(r.endAt), 'dd/MM', { locale: fr })}</p>
                      {daysLeft <= 1 && <p className="text-xs font-semibold text-orange-600">{daysLeft === 0 ? "Aujourd'hui" : "Demain"}</p>}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Alertes */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Alertes {alerts.length > 0 && <span className="ml-1 rounded-full bg-red-100 px-1.5 text-xs font-bold text-red-600">{alerts.length}</span>}
            </h2>
          </div>
          {alerts.length === 0 ? (
            <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-center text-sm font-medium text-green-700">
              Tout est en ordre ✓
            </div>
          ) : (
            <div className="space-y-2">
              {alerts.map(a => <AlertCard key={a.id} alert={a} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
