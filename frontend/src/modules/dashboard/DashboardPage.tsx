import React, { useEffect } from 'react';
import { trackEvent } from '../../utils/tracking';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, differenceInDays, isPast } from 'date-fns';
import { fr } from 'date-fns/locale';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../../utils/api';

const CHART_COLORS = ['#01696e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#10b981', '#f97316', '#06b6d4'];
import { useAuth } from '../../hooks/useAuth';

interface RentalStats { totalRevenue: number; occupancyRate: number; rentalCount: number; totalKm: number; vehicleCount: number; totalPayout: number; }
interface ActiveRental { id: string; driverName: string; startAt: string; endAt: string; vehicle: { make: string; model: string; licensePlate: string }; }
interface Alert { id: string; type: string; label: string; severity: 'high' | 'medium'; link: string; }
interface SyncStateData { isRunning: boolean; currentStep: string; progress: number; lastSyncAt: string | null; lastSyncResult: { created: number; updated: number } | null; error: string | null; isTrialLimited: boolean; }

function formatWeekLabel(week: string): string {
  const [yearStr, weekStr] = week.split('-W');
  const year = parseInt(yearStr ?? '2026');
  const weekNum = parseInt(weekStr ?? '1');
  const jan4 = new Date(year, 0, 4);
  const startOfWeek = new Date(jan4);
  startOfWeek.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + (weekNum - 1) * 7);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);
  const fmt = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  return `S${weekNum} · ${fmt(startOfWeek)}→${fmt(endOfWeek)}`;
}

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
  useEffect(() => { void trackEvent('dashboard', 'view'); }, []);

  type CtExpiring = { id: string; expiryAt: string; vehicle: { make: string; model: string; licensePlate: string } };
  type DocExpiring = { id: string; name: string; expiryDate: string; vehicle: { make: string; model: string; licensePlate: string } };
  type PendingCarSeat = { id: string; rental: { id: string; driverName: string } | null; vehicle: { make: string; model: string; licensePlate: string } };
  type CashflowWeek = { week: string; weekStart: string; expectedRevenue: number; rentalCount: number };
  type InboxSummary = { pendingCount: number; unansweredRentals: number };

  const { data: statsData } = useQuery<RentalStats>({
    queryKey: ['rental-stats'],
    queryFn: () => api.get<{ stats: RentalStats }>('/rentals/stats').then(r => r.data.stats),
    staleTime: 2 * 60_000,
  });

  const { data: activeRentals = [] } = useQuery<ActiveRental[]>({
    queryKey: ['rentals', 'active'],
    queryFn: () => api.get<{ rentals: ActiveRental[] }>('/rentals', { params: { status: 'active', limit: 5 } }).then(r => r.data.rentals),
    staleTime: 2 * 60_000,
  });

  const { data: pendingMessages } = useQuery<InboxSummary>({
    queryKey: ['inbox-summary'],
    queryFn: () => api.get<InboxSummary>('/messages/inbox-summary').then(r => r.data),
    refetchInterval: 30_000,
    staleTime: 25_000,
  });

  const { data: expiringCT = [] } = useQuery<CtExpiring[]>({
    queryKey: ['ct-expiring'],
    queryFn: () => api.get<{ controls: CtExpiring[] }>('/technical-control/expiring').then(r => r.data.controls),
    staleTime: 5 * 60_000,
  });

  const { data: expiringDocs = [] } = useQuery<DocExpiring[]>({
    queryKey: ['docs-expiring'],
    queryFn: () => api.get<{ documents: DocExpiring[] }>('/documents/expiring').then(r => r.data.documents),
    staleTime: 5 * 60_000,
  });

  const { data: pendingCarSeats = [] } = useQuery<PendingCarSeat[]>({
    queryKey: ['car-seat-requests', 'pending'],
    queryFn: () => api.get<{ requests: PendingCarSeat[] }>('/car-seat-requests', { params: { status: 'pending' } }).then(r => r.data.requests),
    staleTime: 2 * 60_000,
  });

  const { data: cashflowForecast = [] } = useQuery<CashflowWeek[]>({
    queryKey: ['cashflow-forecast'],
    queryFn: () => api.get<{ forecast: CashflowWeek[] }>('/ai/cashflow-forecast').then(r => r.data.forecast),
    staleTime: 5 * 60_000,
    enabled: user?.role !== 'carkeeper',
  });

  type PendingRevenueData = {
    pendingRevenue: { amount: number; count: number; oldestDate: string | null; note: string };
    forecastRevenue: { byMonth: { month: string; rentalCount: number; amount: number; estimated: boolean }[]; total: number; count: number };
  };
  const { data: pendingRevenueData } = useQuery<PendingRevenueData>({
    queryKey: ['pending-revenue'],
    queryFn: () => api.get<PendingRevenueData>('/intelligence/pending-revenue').then(r => r.data),
    staleTime: 5 * 60_000,
    enabled: user?.role !== 'carkeeper',
  });

  const { data: syncStatus } = useQuery<SyncStateData>({
    queryKey: ['sync-status'],
    queryFn: () => api.get<{ state: SyncStateData }>('/sync/status').then(r => r.data.state),
    refetchInterval: (query) => ((query.state.data as SyncStateData | undefined)?.isRunning ? 3_000 : 30_000),
    staleTime: 2_000,
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
  type OnboardingProgress = { progressPercent: number; completedCount: number; totalCount: number; allDone: boolean; dismissed: boolean };
  const { data: onboarding } = useQuery<OnboardingProgress>({
    queryKey: ['onboarding-progress'],
    queryFn: () => api.get<OnboardingProgress>('/onboarding/progress').then(r => r.data),
    staleTime: 2 * 60_000,
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

      {/* Bannière trial */}
      {syncStatus?.isTrialLimited && (
        <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
          <svg className="h-5 w-5 shrink-0 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div>
            <p className="text-sm font-semibold text-amber-800">Mode essai — données limitées à 90 jours</p>
            <p className="text-xs text-amber-600">Passez à un abonnement pour synchroniser l'historique complet.</p>
          </div>
        </div>
      )}

      {/* Widget progression sync */}
      {syncStatus && (syncStatus.isRunning || syncStatus.error != null || syncStatus.lastSyncAt != null) && (
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
          {syncStatus.isRunning ? (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-medium text-gray-700">
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[#01696e] border-t-transparent" />
                  {syncStatus.currentStep}
                </span>
                <span className="text-xs text-gray-400">{syncStatus.progress}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                <div className="h-full rounded-full bg-[#01696e] transition-all duration-500" style={{ width: `${syncStatus.progress}%` }} />
              </div>
            </div>
          ) : syncStatus.error != null ? (
            <p className="text-sm text-red-600">Erreur sync : {syncStatus.error}</p>
          ) : syncStatus.lastSyncAt != null ? (
            <div className="flex items-center justify-between text-xs text-gray-400">
              <span>Dernière sync : {format(new Date(syncStatus.lastSyncAt), 'dd/MM à HH:mm', { locale: fr })}</span>
              {syncStatus.lastSyncResult && (
                <span>{syncStatus.lastSyncResult.created} créés · {syncStatus.lastSyncResult.updated} mis à jour</span>
              )}
            </div>
          ) : null}
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

          {/* Cartes financières prévisionnelles */}
          {pendingRevenueData && (
            <div className="mt-3 grid gap-3 grid-cols-1 sm:grid-cols-2">
              <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-base">💰</span>
                  <p className="text-xs font-semibold uppercase tracking-wide text-yellow-700">À encaisser</p>
                </div>
                <p className="text-2xl font-bold text-yellow-900">
                  {pendingRevenueData.pendingRevenue.amount.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
                </p>
                <p className="text-xs text-yellow-600 mt-1">
                  {pendingRevenueData.pendingRevenue.count} location{pendingRevenueData.pendingRevenue.count !== 1 ? 's' : ''} terminée{pendingRevenueData.pendingRevenue.count !== 1 ? 's' : ''} — {pendingRevenueData.pendingRevenue.note}
                </p>
              </div>
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-base">📅</span>
                  <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Prévisionnel</p>
                </div>
                <p className="text-2xl font-bold text-blue-900">
                  {pendingRevenueData.forecastRevenue.total.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
                </p>
                <p className="text-xs text-blue-600 mt-1">
                  Basé sur {pendingRevenueData.forecastRevenue.count} réservation{pendingRevenueData.forecastRevenue.count !== 1 ? 's' : ''} à venir (90 jours)
                </p>
              </div>
            </div>
          )}
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
                <XAxis dataKey="week" tick={{ fontSize: 10 }} tickFormatter={formatWeekLabel} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(v: number) => [v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }), 'CA prévu']}
                  labelFormatter={(l: string) => formatWeekLabel(l)}
                />
                <Bar dataKey="expectedRevenue" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
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
