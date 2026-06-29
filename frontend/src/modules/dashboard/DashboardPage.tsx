import React, { useEffect } from 'react';
import { trackEvent } from '../../utils/tracking';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, differenceInDays, isPast, addDays, startOfDay, isSameDay } from 'date-fns';
import { fr } from 'date-fns/locale';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid, Cell } from 'recharts';
import { api } from '../../utils/api';

const CHART_COLORS = ['#01696e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#10b981', '#f97316', '#06b6d4'];
import { useAuth } from '../../hooks/useAuth';

interface RentalStats { totalRevenue: number; totalEncaisse: number; totalPrevisionnel: number; occupancyRate: number; rentalCount: number; countDone: number; countUpcoming: number; totalKm: number; vehicleCount: number; totalPayout: number; }
interface ActiveRental { id: string; driverName: string; startAt: string; endAt: string; vehicleId: string; vehicle: { make: string; model: string; licensePlate: string }; }
interface Alert { id: string; type: string; label: string; severity: 'high' | 'medium'; link: string; }
interface SyncStateData { isRunning: boolean; currentStep: string; progress: number; lastSyncAt: string | null; lastSyncResult: { created: number; updated: number } | null; error: string | null; isTrialLimited: boolean; }
interface TodayData { departs: number; retours: number; actives: number; disponibles: number; vehicleCount: number; accessoiresJour: { type: string; locataire: string; plaque: string; heure: string }[]; }
interface PipelineData { caReserve: number; nbLocations: number; occupationProjetee: number; parSemaine: { label: string; rentalCount: number; caEstime: number }[]; }
interface UnderutilizedVehicle { vehicleId: string; plate: string; make: string; model: string; zone: string; next28Count: number; past28Count: number; ecartPct: number; isUnderUtilized: boolean; }
interface UnderutilizedData { vehicles: UnderutilizedVehicle[]; avgNext28: number; bestPerformer: { plate: string; next28Count: number } | null; }

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
void formatWeekLabel; // used in chartData below via occupancyData

function GaugeCard({ label, value, sub, gaugePct, gaugeColor, link }: {
  label: string; value: string; sub?: string; gaugePct?: number; gaugeColor?: string; link?: string;
}): React.JSX.Element {
  const inner = (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm h-full flex flex-col">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1.5 text-2xl font-bold text-gray-900 leading-tight">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-400">{sub}</p>}
      {gaugePct !== undefined && (
        <div className="mt-auto pt-2">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, Math.max(0, gaugePct))}%`, backgroundColor: gaugeColor ?? '#01696e' }} />
          </div>
        </div>
      )}
    </div>
  );
  return link ? <Link to={link} className="block hover:opacity-90 transition h-full">{inner}</Link> : <div className="h-full">{inner}</div>;
}

function AlertCard({ alert }: { alert: Alert }): React.JSX.Element {
  return (
    <Link to={alert.link}
      className={`flex items-center gap-3 rounded-xl border-l-4 bg-white px-4 py-3 shadow-sm transition hover:shadow-md ${alert.severity === 'high' ? 'border-red-500' : 'border-orange-400'}`}>
      <p className={`flex-1 text-sm font-medium ${alert.severity === 'high' ? 'text-red-800' : 'text-orange-800'}`}>{alert.label}</p>
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
  type PendingCarSeat = { id: string; rental: { id: string; driverName: string; endAt: string } | null; vehicle: { make: string; model: string; licensePlate: string } };
  type ForecastWeek = { week: string; label: string; rentalCount: number; encaisse: number; previsionnel: number; totalPayout: number };
  type OccupancyVehicle = { id: string; name: string; occupancy: number };
  type OccupancyWeek = { week: string; label: string; vehicles: OccupancyVehicle[]; globalOccupancy: number };
  type UnansweredMsg = { rentalId: string; driverName: string; vehicleLabel: string; msgPreview: string; createdAt: string };
  type PendingApprovalMsg = { messageId: string; rentalId: string; driverName: string; vehicleLabel: string };
  type InboxSummary = { pendingCount: number; unansweredRentals: number; unansweredMessages: UnansweredMsg[]; pendingApprovalMessages: PendingApprovalMsg[] };
  type MaintenanceAlert = {
    id: string;
    type: 'revision' | 'ct';
    nextDueDate: string | null;
    nextDueMileage: number | null;
    ctResult: string | null;
    ctCounterVisitDeadline: string | null;
    occurrenceCount: number;
    vehicle: { id: string; make: string; model: string; licensePlate: string; vehicleCategory: string };
  };

  const { data: statsData } = useQuery<RentalStats>({
    queryKey: ['rental-stats'],
    queryFn: () => api.get<{ stats: RentalStats }>('/rentals/stats').then(r => r.data.stats),
    staleTime: 2 * 60_000,
  });

  const { data: activeRentals = [] } = useQuery<ActiveRental[]>({
    queryKey: ['rentals', 'active'],
    queryFn: () => api.get<{ rentals: ActiveRental[] }>('/rentals', { params: { status: 'active', limit: 20 } }).then(r => r.data.rentals),
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

  const { data: forecastData } = useQuery<{ forecasts: ForecastWeek[]; totalForecast: number }>({
    queryKey: ['dashboard-forecasts'],
    queryFn: () => api.get<{ forecasts: ForecastWeek[]; totalForecast: number }>('/intelligence/forecasts').then(r => r.data),
    staleTime: 5 * 60_000,
    enabled: user?.role !== 'carkeeper',
  });
  void forecastData;

  const { data: occupancyData } = useQuery<OccupancyWeek[]>({
    queryKey: ['dashboard-occupancy'],
    queryFn: () => api.get<OccupancyWeek[]>('/dashboard/occupancy').then(r => r.data),
    staleTime: 5 * 60_000,
    enabled: user?.role !== 'carkeeper',
  });

  const { data: upcomingMaintenances = [] } = useQuery<MaintenanceAlert[]>({
    queryKey: ['dashboard-maintenances'],
    queryFn: () => api.get<{ maintenances: MaintenanceAlert[] }>('/dashboard/maintenances').then(r => r.data.maintenances),
    staleTime: 5 * 60_000,
  });

  const { data: copilotData, isLoading: copilotLoading } = useQuery<{ text: string }>({
    queryKey: ['dashboard-copilot'],
    queryFn: () => api.get<{ text: string }>('/dashboard/copilot').then(r => r.data),
    staleTime: 3_600_000,
    retry: false,
  });

  const { data: syncStatus } = useQuery<SyncStateData>({
    queryKey: ['sync-status'],
    queryFn: () => api.get<{ state: SyncStateData }>('/sync/status').then(r => r.data.state),
    refetchInterval: (query) => ((query.state.data as SyncStateData | undefined)?.isRunning ? 3_000 : 30_000),
    staleTime: 2_000,
    enabled: user?.role !== 'carkeeper',
  });

  const { data: todayData } = useQuery<TodayData>({
    queryKey: ['dashboard-today'],
    queryFn: () => api.get<TodayData>('/dashboard/today').then(r => r.data),
    staleTime: 2 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  const { data: pipelineData } = useQuery<PipelineData>({
    queryKey: ['dashboard-pipeline'],
    queryFn: () => api.get<PipelineData>('/dashboard/pipeline').then(r => r.data),
    staleTime: 5 * 60_000,
    enabled: user?.role !== 'carkeeper',
  });

  const { data: underutilizedData } = useQuery<UnderutilizedData>({
    queryKey: ['dashboard-underutilized'],
    queryFn: () => api.get<UnderutilizedData>('/dashboard/underutilized').then(r => r.data),
    staleTime: 10 * 60_000,
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
    ...pendingCarSeats
      .filter(r => !r.rental || new Date(r.rental.endAt) >= new Date())
      .slice(0, 2).map(r => ({
        id: `csr-${r.id}`, type: 'car_seat', severity: 'medium' as const,
        label: `Siège auto demandé — ${r.vehicle.make} ${r.vehicle.model} (${r.vehicle.licensePlate})${r.rental ? ` · ${r.rental.driverName}` : ''}`,
        link: r.rental ? `/messages?rentalId=${r.rental.id}` : '/messages',
      })),
    ...(pendingMessages?.pendingApprovalMessages ?? []).map(m => ({
      id: `draft-${m.rentalId}`, type: 'message_draft', severity: 'medium' as const,
      label: `💬 Brouillon à valider — ${m.driverName} · ${m.vehicleLabel}`,
      link: `/messages?rentalId=${m.rentalId}`,
    })),
    ...(pendingMessages?.unansweredMessages ?? []).map(m => ({
      id: `unread-${m.rentalId}`, type: 'unanswered_message', severity: 'high' as const,
      label: `💬 Message sans réponse — ${m.driverName} · ${m.vehicleLabel} : « ${m.msgPreview}${m.msgPreview.length >= 80 ? '…' : ''} »`,
      link: `/messages?rentalId=${m.rentalId}`,
    })),
    ...upcomingMaintenances.slice(0, 3).map(m => {
      const vLabel = `${m.vehicle.make} ${m.vehicle.model} (${m.vehicle.licensePlate})`;
      const isCtContreVisite = m.type === 'ct' && (m.ctResult === 'defavorable' || m.ctResult === 'contre_visite');
      const deadline = isCtContreVisite && m.ctCounterVisitDeadline ? new Date(m.ctCounterVisitDeadline) : m.nextDueDate ? new Date(m.nextDueDate) : null;
      const overdue = deadline ? isPast(deadline) : false;
      const severity = overdue ? 'high' as const : 'medium' as const;
      const link = m.type === 'ct' ? '/ct' : '/maintenance';
      let label: string;
      if (m.occurrenceCount === 0) {
        label = `${m.type === 'ct' ? 'CT' : 'Révision'} ${vLabel} — à renseigner`;
      } else if (m.type === 'ct' && isCtContreVisite) {
        const dl = m.ctCounterVisitDeadline ? new Date(m.ctCounterVisitDeadline) : null;
        label = `Contre-visite CT ${vLabel}${dl ? (isPast(dl) ? ` — délai dépassé le ${format(dl, 'dd/MM/yy', { locale: fr })}` : ` — avant le ${format(dl, 'dd/MM/yy', { locale: fr })}`) : ''}`;
      } else if (m.type === 'ct') {
        label = `CT ${vLabel}${m.nextDueDate ? (isPast(new Date(m.nextDueDate)) ? ` — expiré le ${format(new Date(m.nextDueDate), 'dd/MM/yy', { locale: fr })}` : ` — à renouveler avant le ${format(new Date(m.nextDueDate), 'dd/MM/yy', { locale: fr })}`) : ''}`;
      } else {
        label = `Révision ${vLabel}${m.nextDueDate ? (isPast(new Date(m.nextDueDate)) ? ` — date dépassée (${format(new Date(m.nextDueDate), 'dd/MM/yy', { locale: fr })})` : ` — à prévoir avant le ${format(new Date(m.nextDueDate), 'dd/MM/yy', { locale: fr })}`) : ''}`;
        if (m.nextDueMileage != null) {
          label += ` · ${m.nextDueMileage.toLocaleString('fr-FR')} km`;
        }
      }
      return { id: `maint-${m.id}`, type: 'maintenance', severity, label, link };
    }),
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

  // Mini planning 7j — depuis activeRentals
  const today = startOfDay(new Date());
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const miniPlanVehicles = occupancyData?.[0]?.vehicles ?? [];

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

      {/* D2a — Bandeau quotidien */}
      {todayData && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 flex flex-col">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Départs</span>
            <span className="mt-1 text-2xl font-bold text-[#01696e]">{todayData.departs}</span>
            <span className="text-xs text-gray-400">aujourd'hui</span>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 flex flex-col">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Retours</span>
            <span className="mt-1 text-2xl font-bold text-blue-600">{todayData.retours}</span>
            <span className="text-xs text-gray-400">aujourd'hui</span>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 flex flex-col">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">En cours</span>
            <span className="mt-1 text-2xl font-bold text-gray-900">{todayData.actives}</span>
            <span className="text-xs text-gray-400">locations actives</span>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 flex flex-col">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Disponibles</span>
            <span className="mt-1 text-2xl font-bold text-gray-900">{todayData.disponibles}</span>
            <span className="text-xs text-gray-400">sur {todayData.vehicleCount} véhicules</span>
          </div>
          {todayData.accessoiresJour.length > 0 && (
            <div className="col-span-2 sm:col-span-4 rounded-xl border border-orange-200 bg-orange-50 px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="text-xs font-semibold text-orange-700">🪑 Sièges auto aujourd'hui :</span>
              {todayData.accessoiresJour.map((a, i) => (
                <span key={i} className="text-xs text-orange-700">{a.plaque} · {a.locataire} à {a.heure}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* D2b — Accueil + Copilote */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{greeting}, {user?.name?.split(' ')[0]} 👋</h1>
        <p className="text-sm text-gray-500">{format(new Date(), "EEEE d MMMM yyyy", { locale: fr })}</p>
        {copilotLoading ? (
          <div className="mt-3 rounded-xl border-l-4 border-[#01696e] bg-[#f0fdf4] px-4 py-3 space-y-2">
            <div className="h-3.5 w-3/4 animate-pulse rounded bg-green-200" />
            <div className="h-3.5 w-2/3 animate-pulse rounded bg-green-200" />
            <div className="h-3.5 w-1/2 animate-pulse rounded bg-green-200" />
          </div>
        ) : copilotData?.text ? (
          <div className="mt-3 rounded-xl border-l-4 border-[#01696e] bg-[#f0fdf4] px-4 py-3">
            <p className="text-sm text-gray-700">✨ {copilotData.text}</p>
          </div>
        ) : null}
      </div>

      {/* D2c — KPIs jauges du mois */}
      {user?.role !== 'carkeeper' && (
        <div>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Ce mois-ci</h2>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            {stats ? (() => {
              const totalCA = stats.totalEncaisse + stats.totalPrevisionnel;
              const pctEnc = totalCA > 0 ? (stats.totalEncaisse / totalCA) * 100 : 0;
              return (
                <Link to="/rentals" className="block hover:opacity-90 transition">
                  <GaugeCard
                    label="Chiffre d'affaires"
                    value={totalCA.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })}
                    sub={`${stats.totalEncaisse.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })} enc. · ${stats.totalPrevisionnel.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })} prévu`}
                    gaugePct={pctEnc}
                    gaugeColor="#16a34a"
                  />
                </Link>
              );
            })() : (
              <GaugeCard label="Chiffre d'affaires" value="—" link="/rentals" />
            )}
            {stats ? (
              <GaugeCard
                label="Taux d'occupation"
                value={`${stats.occupancyRate} %`}
                sub={`${stats.vehicleCount} véhicule${stats.vehicleCount !== 1 ? 's' : ''}`}
                gaugePct={stats.occupancyRate}
                gaugeColor={stats.occupancyRate >= 70 ? '#01696e' : stats.occupancyRate >= 50 ? '#f59e0b' : '#ef4444'}
                link="/vehicles"
              />
            ) : (
              <GaugeCard label="Taux d'occupation" value="—" link="/vehicles" />
            )}
            {stats ? (
              <Link to="/rentals" className="block hover:opacity-90 transition">
                <GaugeCard
                  label="Locations"
                  value={`${stats.countDone + stats.countUpcoming}`}
                  sub={`${stats.countDone} réalisées · ${stats.countUpcoming} à venir`}
                  gaugePct={stats.countDone > 0 ? (stats.countDone / (stats.countDone + stats.countUpcoming)) * 100 : 0}
                  gaugeColor="#3b82f6"
                />
              </Link>
            ) : (
              <GaugeCard label="Locations" value="—" link="/rentals" />
            )}
            <GaugeCard
              label="Km parcourus"
              value={stats ? stats.totalKm.toLocaleString('fr-FR') : '—'}
              sub="ce mois"
            />
          </div>
        </div>
      )}

      {/* Occupation par véhicule — 4 semaines glissantes */}
      {user?.role !== 'carkeeper' && occupancyData && occupancyData.length > 0 && (() => {
        const vehicleList = occupancyData[0]?.vehicles ?? [];
        const chartData = occupancyData.map(w => {
          const row: Record<string, string | number> = { label: w.label, globalOccupancy: w.globalOccupancy };
          for (const v of w.vehicles) row[v.id] = v.occupancy;
          return row;
        });
        return (
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Occupation par véhicule — 4 semaines</h2>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid stroke="#e5e7eb" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} domain={[0, 100]} />
                  <Tooltip formatter={(v: number, name: string) => [`${v}%`, name]} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  {vehicleList.map((v, i) => (
                    <Bar key={v.id} dataKey={v.id} name={v.name} fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[3, 3, 0, 0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })()}

      {/* D2d — Pipeline 28 jours */}
      {user?.role !== 'carkeeper' && pipelineData && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Pipeline 28 jours</h2>
            <span className="text-xs text-gray-400">{pipelineData.occupationProjetee}% occupation projetée</span>
          </div>
          <div className="grid gap-3 grid-cols-3 mb-3">
            <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">CA réservé</p>
              <p className="mt-1 text-xl font-bold text-[#01696e]">{pipelineData.caReserve.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })}</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Locations</p>
              <p className="mt-1 text-xl font-bold text-gray-900">{pipelineData.nbLocations}</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Occupation</p>
              <p className="mt-1 text-xl font-bold text-gray-900">{pipelineData.occupationProjetee}%</p>
            </div>
          </div>
          {pipelineData.parSemaine.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <ResponsiveContainer width="100%" height={120}>
                <BarChart data={pipelineData.parSemaine} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid stroke="#e5e7eb" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v: number) => [v, 'locations']} />
                  <Bar dataKey="rentalCount" name="Locations" radius={[3, 3, 0, 0]}>
                    {pipelineData.parSemaine.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* D2f — Mini planning 7j */}
      {user?.role !== 'carkeeper' && miniPlanVehicles.length > 0 && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Planning 7 jours</h2>
            <Link to="/planning" className="text-xs text-[#01696e] hover:underline">Planning complet →</Link>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            {/* En-tête jours */}
            <div className="flex border-b border-gray-100">
              <div className="w-32 shrink-0 border-r border-gray-100 px-3 py-2 text-[10px] font-semibold text-gray-400">Véhicule</div>
              {weekDays.map(d => (
                <div key={d.toISOString()} className={`flex-1 border-r border-gray-100 last:border-r-0 py-2 text-center text-[10px] font-medium ${isSameDay(d, today) ? 'bg-[#01696e]/5 text-[#01696e] font-bold' : 'text-gray-400'}`}>
                  <div>{format(d, 'EEE', { locale: fr })}</div>
                  <div>{format(d, 'd')}</div>
                </div>
              ))}
            </div>
            {miniPlanVehicles.slice(0, 8).map(v => (
              <div key={v.id} className="flex border-b border-gray-50 last:border-b-0">
                <div className="w-32 shrink-0 border-r border-gray-100 px-3 py-2 text-xs text-gray-600 truncate">{v.name}</div>
                {weekDays.map(d => {
                  const hasRental = activeRentals.some(r =>
                    r.vehicleId === v.id &&
                    new Date(r.startAt) <= addDays(d, 1) &&
                    new Date(r.endAt) >= d
                  );
                  return (
                    <div key={d.toISOString()} className={`flex-1 border-r border-gray-50 last:border-r-0 py-2 flex items-center justify-center ${isSameDay(d, today) ? 'bg-[#01696e]/5' : ''}`}>
                      {hasRental && (
                        <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: '#01696e' }} />
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* D2e — Sous-utilisation + alertes */}
        <div className="space-y-6">
          {user?.role !== 'carkeeper' && underutilizedData && underutilizedData.vehicles.filter(v => v.isUnderUtilized).length > 0 && (
            <div>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Sous-utilisation proactive
              </h2>
              <div className="space-y-2">
                {underutilizedData.vehicles.filter(v => v.isUnderUtilized).map(v => (
                  <div key={v.vehicleId} className="flex items-center gap-3 rounded-xl border-l-4 border-amber-400 bg-white px-4 py-3 shadow-sm">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">{v.make} {v.model} <span className="font-mono text-xs text-gray-400">{v.plate}</span></p>
                      <p className="text-xs text-gray-500">{v.next28Count} loc. prévues vs {v.past28Count} les 28j passés</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                      {v.ecartPct}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

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
              {activeRentals.slice(0, 5).map(r => {
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
      </div>
    </div>
  );
}
