import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import saApi, { getSuperAdminUser, clearSuperAdminSession } from './superadminApi';

// ─── Types ────────────────────────────────────────────────────────────────────

type Plan = 'starter' | 'pro' | 'enterprise';

interface AnalyticsEntry {
  id: string; name: string; slug: string; plan: Plan;
  vehicleCount: number; rentalCount: number; messageCount: number;
  lastActivityAt: string | null; inactiveDays: number | null;
  moduleUsage: Array<{ module: string; count: number }>;
  trialEndsAt: string | null; trialDaysLeft: number | null;
  alertInactive: boolean; alertTrial: boolean; alertSyncError: boolean;
}

interface TenantFeedback {
  id: string; type: string; title: string; description: string; status: string; submittedAt: string;
  company: { id: string; name: string; slug: string };
}

interface Company {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  primaryColor: string;
  plan: Plan;
  isActive: boolean;
  trialEndsAt: string | null;
  createdAt: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  _count: { billingEvents: number };
  tenantStats: { userCount: number; vehicleCount: number; rentalCount: number; activeRentals?: number } | null;
  lastActivityAt: string | null;
  alertInactive: boolean;
  alertTrial: boolean;
}

interface CompanyDetail extends Company {
  secondaryColor: string;
  icalToken: string | null;
  billingEvents: Array<{ id: string; type: string; stripeEventId: string; processedAt: string }>;
  tenantStats: { userCount: number; vehicleCount: number; rentalCount: number; activeRentals: number } | null;
}

interface Stats {
  total: number;
  active: number;
  inactive: number;
  onTrial: number;
  perPlan: Record<string, number>;
  mrrTotal: number;
  arrTotal: number;
  tenantCount: number;
  churnRisk: number;
  trialExpiringSoon: number;
  planDistribution: { starter: number; pro: number; enterprise: number };
}

interface SuperAdmin {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PLAN_CONFIG: Record<Plan, { label: string; bg: string; text: string }> = {
  starter:    { label: 'Starter',    bg: 'bg-gray-100',   text: 'text-gray-600' },
  pro:        { label: 'Pro',        bg: 'bg-blue-100',   text: 'text-blue-700' },
  enterprise: { label: 'Enterprise', bg: 'bg-purple-100', text: 'text-purple-700' },
};

const PLANS: Plan[] = ['starter', 'pro', 'enterprise'];

function slugify(str: string): string {
  return str.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const EMPTY_COMPANY_FORM = {
  name: '', slug: '', tenantDbUrl: '', plan: 'starter' as Plan, trialDays: 14, primaryColor: '#01696e',
  siret: '', managerName: '', phone: '', contactEmail: '', address: '', city: '', postalCode: '',
};

const EMPTY_ADMIN_FORM = { name: '', email: '', password: '' };

// ─── Guard superadmin ────────────────────────────────────────────────────────

function SuperAdminGuard({ children }: { children: React.ReactNode }): React.JSX.Element {
  const navigate = useNavigate();
  const token = localStorage.getItem('superadmin_token');
  if (!token) {
    navigate('/superadmin/login', { replace: true });
    return <></>;
  }
  return <>{children}</>;
}

// ─── Dashboard principal ─────────────────────────────────────────────────────

export default function SuperAdminDashboard(): React.JSX.Element {
  return (
    <SuperAdminGuard>
      <DashboardContent />
    </SuperAdminGuard>
  );
}

function DashboardContent(): React.JSX.Element {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const currentAdmin = getSuperAdminUser();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<'companies' | 'analytics' | 'feedbacks' | 'admins'>('companies');
  const [showCompanyForm, setShowCompanyForm] = useState(false);
  const [showAdminForm, setShowAdminForm] = useState(false);
  const [companyForm, setCompanyForm] = useState(EMPTY_COMPANY_FORM);
  const [adminForm, setAdminForm] = useState(EMPTY_ADMIN_FORM);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);

  // ── Requêtes ─────────────────────────────────────────────────────────────────

  const { data: statsData } = useQuery<{ stats: Stats }>({
    queryKey: ['sa-stats'],
    queryFn: () => saApi.get('/superadmin/stats').then(r => r.data as { stats: Stats }),
  });

  const { data: companiesData, isLoading } = useQuery<{ companies: Company[] }>({
    queryKey: ['sa-companies'],
    queryFn: () => saApi.get('/superadmin/companies').then(r => r.data as { companies: Company[] }),
  });

  const { data: detailData } = useQuery<{ company: CompanyDetail; tenantStats: CompanyDetail['tenantStats'] }>({
    queryKey: ['sa-company', selectedId],
    queryFn: () => saApi.get(`/superadmin/companies/${selectedId}`).then(r => r.data as { company: CompanyDetail; tenantStats: CompanyDetail['tenantStats'] }),
    enabled: Boolean(selectedId),
  });

  const { data: adminsData } = useQuery<{ admins: SuperAdmin[] }>({
    queryKey: ['sa-admins'],
    queryFn: () => saApi.get('/superadmin/admins').then(r => r.data as { admins: SuperAdmin[] }),
    enabled: activeSection === 'admins',
  });

  const { data: analyticsData } = useQuery<{ analytics: AnalyticsEntry[] }>({
    queryKey: ['sa-analytics'],
    queryFn: () => saApi.get('/superadmin/analytics').then(r => r.data as { analytics: AnalyticsEntry[] }),
    enabled: activeSection === 'analytics',
    staleTime: 5 * 60_000,
  });

  const [feedbackFilter, setFeedbackFilter] = useState<string>('');
  const { data: feedbacksData, refetch: refetchFeedbacks } = useQuery<{ feedbacks: TenantFeedback[] }>({
    queryKey: ['sa-feedbacks', feedbackFilter],
    queryFn: () => saApi.get(`/superadmin/feedbacks${feedbackFilter ? `?status=${feedbackFilter}` : ''}`).then(r => r.data as { feedbacks: TenantFeedback[] }),
    enabled: activeSection === 'feedbacks',
  });

  const updateFeedbackStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      saApi.patch(`/superadmin/feedbacks/${id}`, { status }),
    onSuccess: () => { void refetchFeedbacks(); },
  });

  // ── Mutations ────────────────────────────────────────────────────────────────

  const createCompany = useMutation({
    mutationFn: (data: typeof EMPTY_COMPANY_FORM) => saApi.post('/superadmin/companies', data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sa-companies'] });
      void qc.invalidateQueries({ queryKey: ['sa-stats'] });
      setShowCompanyForm(false);
      setCompanyForm(EMPTY_COMPANY_FORM);
    },
  });

  const updateCompany = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Company> }) =>
      saApi.put(`/superadmin/companies/${id}`, data),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['sa-companies'] });
      void qc.invalidateQueries({ queryKey: ['sa-company', vars.id] });
      void qc.invalidateQueries({ queryKey: ['sa-stats'] });
      setEditingPlan(null);
    },
  });

  const createAdmin = useMutation({
    mutationFn: (data: typeof EMPTY_ADMIN_FORM) => saApi.post('/superadmin/admins', data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sa-admins'] });
      setShowAdminForm(false);
      setAdminForm(EMPTY_ADMIN_FORM);
    },
  });

  // ── Handlers ─────────────────────────────────────────────────────────────────

  function handleLogout() {
    clearSuperAdminSession();
    navigate('/superadmin/login');
  }

  const companies = companiesData?.companies ?? [];
  const stats = statsData?.stats;
  const admins = adminsData?.admins ?? [];
  const detail = detailData?.company ?? null;

  // ── Rendu ────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Header */}
      <header className="flex h-14 items-center justify-between border-b border-gray-800 bg-gray-900 px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ backgroundColor: '#01696e' }}>
            <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <span className="text-sm font-semibold text-white">Super Admin</span>
          <div className="flex gap-1 ml-4">
            {(['companies', 'analytics', 'feedbacks', 'admins'] as const).map(s => (
              <button key={s} type="button" onClick={() => setActiveSection(s)}
                className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                  activeSection === s ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'
                }`}>
                {s === 'companies' ? 'Sociétés' : s === 'analytics' ? 'Analytics' : s === 'feedbacks' ? 'Feedbacks' : 'Super admins'}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">{currentAdmin?.name}</span>
          <button type="button" onClick={handleLogout}
            className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-400 hover:text-white">
            Déconnexion
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Section Sociétés ─────────────────────────────────────────────────── */}
        {activeSection === 'companies' && (
          <>
            {/* Panneau gauche */}
            <div className="flex w-80 shrink-0 flex-col border-r border-gray-800">
              {/* Stats */}
              {stats && (
                <div className="border-b border-gray-800">
                  {/* MRR / ARR */}
                  <div className="grid grid-cols-2 gap-px bg-gray-800">
                    <div className="bg-gray-900 p-3 text-center">
                      <p className="text-lg font-bold text-emerald-400">
                        {stats.mrrTotal.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })}
                      </p>
                      <p className="text-[10px] text-gray-500 uppercase">MRR</p>
                    </div>
                    <div className="bg-gray-900 p-3 text-center">
                      <p className="text-lg font-bold text-blue-400">
                        {stats.arrTotal.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })}
                      </p>
                      <p className="text-[10px] text-gray-500 uppercase">ARR</p>
                    </div>
                  </div>
                  {/* Compteurs */}
                  <div className="grid grid-cols-3 gap-px bg-gray-800">
                    <div className="bg-gray-900 p-2.5 text-center">
                      <p className="text-base font-bold text-white">{stats.total}</p>
                      <p className="text-[10px] text-gray-500 uppercase">Total</p>
                    </div>
                    <div className="bg-gray-900 p-2.5 text-center">
                      <p className={`text-base font-bold ${stats.churnRisk > 0 ? 'text-red-400' : 'text-gray-400'}`}>
                        {stats.churnRisk}
                      </p>
                      <p className="text-[10px] text-gray-500 uppercase">Churn risk</p>
                    </div>
                    <div className="bg-gray-900 p-2.5 text-center">
                      <p className={`text-base font-bold ${stats.trialExpiringSoon > 0 ? 'text-orange-400' : 'text-gray-400'}`}>
                        {stats.trialExpiringSoon}
                      </p>
                      <p className="text-[10px] text-gray-500 uppercase">Trial J-3</p>
                    </div>
                  </div>
                  {/* Plan distribution */}
                  <div className="flex gap-px bg-gray-800">
                    {(['starter', 'pro', 'enterprise'] as Plan[]).map(p => (
                      <div key={p} className={`flex-1 bg-gray-900 p-2 text-center`}>
                        <p className={`text-sm font-semibold ${PLAN_CONFIG[p].text}`}>
                          {stats.planDistribution?.[p] ?? stats.perPlan[p] ?? 0}
                        </p>
                        <p className="text-[9px] text-gray-600 uppercase">{p}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Bouton créer */}
              <div className="border-b border-gray-800 p-3">
                <button type="button" onClick={() => setShowCompanyForm(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl py-2 text-sm font-medium text-white"
                  style={{ backgroundColor: '#01696e' }}>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Nouvelle société
                </button>
              </div>

              {/* Liste */}
              <div className="flex-1 overflow-y-auto">
                {isLoading ? (
                  <div className="flex justify-center py-8">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-t-transparent border-[#01696e]" />
                  </div>
                ) : companies.map(c => (
                  <button key={c.id} type="button"
                    onClick={() => setSelectedId(id => id === c.id ? null : c.id)}
                    className={`w-full border-b border-gray-800 px-4 py-3 text-left hover:bg-gray-800/50 transition-colors ${
                      selectedId === c.id ? 'bg-gray-800 border-l-2 border-l-[#01696e]' : ''
                    }`}>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <p className="text-sm font-medium text-white truncate">{c.name}</p>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${PLAN_CONFIG[c.plan].bg} ${PLAN_CONFIG[c.plan].text}`}>
                          {PLAN_CONFIG[c.plan].label}
                        </span>
                        <span className={`h-1.5 w-1.5 rounded-full ${c.isActive ? 'bg-emerald-400' : 'bg-gray-600'}`} />
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                      <p className="text-xs text-gray-500 font-mono">{c.slug}</p>
                      {c.alertInactive && (
                        <span className="rounded-full bg-red-900/50 px-1.5 py-0.5 text-[9px] font-medium text-red-400">
                          Churn risk
                        </span>
                      )}
                      {c.alertTrial && (
                        <span className="rounded-full bg-orange-900/50 px-1.5 py-0.5 text-[9px] font-medium text-orange-400">
                          Trial expire bientôt
                        </span>
                      )}
                    </div>
                    {c.tenantStats && (
                      <div className="flex gap-3 text-[10px] text-gray-500">
                        <span>{c.tenantStats.vehicleCount} véh.</span>
                        <span>{c.tenantStats.userCount} users</span>
                        <span>{c.tenantStats.rentalCount} loc.</span>
                        {c.lastActivityAt && (
                          <span className="ml-auto text-[9px] text-gray-600">
                            {format(new Date(c.lastActivityAt), 'dd/MM HH:mm', { locale: fr })}
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Panneau détail société */}
            <div className="flex-1 overflow-y-auto p-6">
              {!detail ? (
                <div className="flex h-full items-center justify-center">
                  <p className="text-sm text-gray-600">Sélectionne une société</p>
                </div>
              ) : (
                <div className="max-w-2xl space-y-5">
                  {/* En-tête */}
                  <div className="flex items-start justify-between">
                    <div>
                      <h2 className="text-xl font-bold text-white">{detail.name}</h2>
                      <p className="font-mono text-sm text-gray-400">{detail.slug}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        Créée le {format(new Date(detail.createdAt), 'dd MMMM yyyy', { locale: fr })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => updateCompany.mutate({ id: detail.id, data: { isActive: !detail.isActive } })}
                        className={`rounded-xl px-3 py-1.5 text-xs font-medium transition-colors ${
                          detail.isActive
                            ? 'border border-red-800 text-red-400 hover:bg-red-900/20'
                            : 'border border-emerald-800 text-emerald-400 hover:bg-emerald-900/20'
                        }`}>
                        {detail.isActive ? 'Désactiver' : 'Réactiver'}
                      </button>
                    </div>
                  </div>

                  {/* Stats tenant */}
                  {detail.tenantStats && (
                    <div className="grid grid-cols-4 gap-3">
                      {[
                        { label: 'Utilisateurs', value: detail.tenantStats.userCount },
                        { label: 'Véhicules', value: detail.tenantStats.vehicleCount },
                        { label: 'Locations', value: detail.tenantStats.rentalCount },
                        { label: 'En cours', value: detail.tenantStats.activeRentals },
                      ].map(s => (
                        <div key={s.label} className="rounded-xl border border-gray-800 bg-gray-900 p-4 text-center">
                          <p className="text-2xl font-bold text-white">{s.value}</p>
                          <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Plan + statut */}
                  <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Abonnement</h3>
                    <div className="flex items-center gap-3 mb-4">
                      {PLANS.map(p => (
                        <button key={p} type="button"
                          onClick={() => updateCompany.mutate({ id: detail.id, data: { plan: p } })}
                          className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                            detail.plan === p
                              ? `${PLAN_CONFIG[p].bg} ${PLAN_CONFIG[p].text} ring-2 ring-offset-1 ring-offset-gray-900`
                              : 'border border-gray-700 text-gray-400 hover:border-gray-600'
                          }`}>
                          {PLAN_CONFIG[p].label}
                        </button>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-gray-500">Statut</p>
                        <p className={detail.isActive ? 'text-emerald-400' : 'text-gray-500'}>
                          {detail.isActive ? 'Active' : 'Désactivée'}
                        </p>
                      </div>
                      {detail.trialEndsAt && (
                        <div>
                          <p className="text-xs text-gray-500">Fin essai</p>
                          <p className="text-yellow-400">
                            {format(new Date(detail.trialEndsAt), 'dd/MM/yyyy', { locale: fr })}
                          </p>
                        </div>
                      )}
                      {detail.stripeCustomerId && (
                        <div>
                          <p className="text-xs text-gray-500">Stripe customer</p>
                          <p className="font-mono text-xs text-gray-300">{detail.stripeCustomerId}</p>
                        </div>
                      )}
                      {detail.icalToken && (
                        <div>
                          <p className="text-xs text-gray-500">Token iCal</p>
                          <p className="font-mono text-xs text-gray-400 truncate">{detail.icalToken}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Événements de facturation */}
                  {detail.billingEvents.length > 0 && (
                    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
                        Facturation ({detail._count.billingEvents} événements)
                      </h3>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {detail.billingEvents.map(e => (
                          <div key={e.id} className="flex items-center justify-between text-xs">
                            <span className="font-mono text-gray-400">{e.type}</span>
                            <span className="text-gray-600">
                              {format(new Date(e.processedAt), 'dd/MM/yy HH:mm', { locale: fr })}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {/* ── Section Analytics ─────────────────────────────────────────────── */}
        {activeSection === 'analytics' && (
          <div className="flex-1 p-6 overflow-y-auto">
            <div className="max-w-4xl space-y-4">
              <h2 className="text-lg font-bold text-white">Analytics — Activité tenants</h2>
              {!analyticsData ? (
                <div className="flex justify-center py-12">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-t-transparent border-[#01696e]" />
                </div>
              ) : analyticsData.analytics.length === 0 ? (
                <p className="text-sm text-gray-600 py-8">Aucune donnée</p>
              ) : (
                <div className="space-y-3">
                  {analyticsData.analytics.map(entry => (
                    <div key={entry.id}
                      className="rounded-xl border border-gray-800 bg-gray-900 p-5">
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-semibold text-white">{entry.name}</p>
                            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${PLAN_CONFIG[entry.plan].bg} ${PLAN_CONFIG[entry.plan].text}`}>
                              {PLAN_CONFIG[entry.plan].label}
                            </span>
                            {entry.alertInactive && (
                              <span className="rounded-full bg-red-900/40 px-2 py-0.5 text-[10px] font-medium text-red-400">
                                Inactif {entry.inactiveDays}j
                              </span>
                            )}
                            {entry.alertTrial && (
                              <span className="rounded-full bg-orange-900/40 px-2 py-0.5 text-[10px] font-medium text-orange-400">
                                Essai J-{entry.trialDaysLeft}
                              </span>
                            )}
                            {entry.alertSyncError && (
                              <span className="rounded-full bg-red-900/60 px-2 py-0.5 text-[10px] font-medium text-red-300">
                                ⚠️ Sync en erreur
                              </span>
                            )}
                          </div>
                          <p className="font-mono text-xs text-gray-500 mt-0.5">{entry.slug}</p>
                        </div>
                        <div className="flex gap-4 text-center shrink-0">
                          {[
                            { label: 'Véh.', value: entry.vehicleCount },
                            { label: 'Loc.', value: entry.rentalCount },
                            { label: 'Msg.', value: entry.messageCount },
                          ].map(s => (
                            <div key={s.label}>
                              <p className="text-lg font-bold text-white">{s.value}</p>
                              <p className="text-[10px] text-gray-500">{s.label}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                      {entry.moduleUsage.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {entry.moduleUsage.map(m => (
                            <div key={m.module} className="flex items-center gap-1.5 rounded-lg bg-gray-800 px-2.5 py-1">
                              <span className="text-xs text-gray-400 capitalize">{m.module}</span>
                              <span className="text-xs font-semibold text-[#01696e]">{m.count}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {entry.lastActivityAt && (
                        <p className="mt-2 text-[10px] text-gray-600">
                          Dernière activité : {format(new Date(entry.lastActivityAt), 'dd/MM/yyyy HH:mm', { locale: fr })}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Section Feedbacks ─────────────────────────────────────────────── */}
        {activeSection === 'feedbacks' && (
          <div className="flex-1 p-6 overflow-y-auto">
            <div className="max-w-3xl space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Feedbacks tenants</h2>
                <div className="flex gap-1">
                  {(['', 'new', 'in_progress', 'done', 'rejected'] as const).map(f => (
                    <button key={f} type="button" onClick={() => setFeedbackFilter(f)}
                      className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                        feedbackFilter === f ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'
                      }`}>
                      {f === '' ? 'Tous' : f === 'new' ? 'Nouveau' : f === 'in_progress' ? 'En cours' : f === 'done' ? 'Résolu' : 'Rejeté'}
                    </button>
                  ))}
                </div>
              </div>
              {!feedbacksData ? (
                <div className="flex justify-center py-12">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-t-transparent border-[#01696e]" />
                </div>
              ) : feedbacksData.feedbacks.length === 0 ? (
                <p className="text-sm text-gray-600 py-8">Aucun feedback</p>
              ) : (
                <div className="space-y-3">
                  {feedbacksData.feedbacks.map(fb => (
                    <div key={fb.id} className="rounded-xl border border-gray-800 bg-gray-900 p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              fb.type === 'bug' ? 'bg-red-900/40 text-red-400'
                              : fb.type === 'feature' ? 'bg-blue-900/40 text-blue-400'
                              : 'bg-gray-700 text-gray-300'
                            }`}>
                              {fb.type === 'bug' ? 'Bug' : fb.type === 'feature' ? 'Fonctionnalité' : 'Retour'}
                            </span>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              fb.status === 'new' ? 'bg-yellow-900/40 text-yellow-400'
                              : fb.status === 'in_progress' ? 'bg-blue-900/40 text-blue-400'
                              : fb.status === 'done' ? 'bg-emerald-900/40 text-emerald-400'
                              : 'bg-gray-700 text-gray-500'
                            }`}>
                              {fb.status === 'new' ? 'Nouveau' : fb.status === 'in_progress' ? 'En cours' : fb.status === 'done' ? 'Résolu' : 'Rejeté'}
                            </span>
                            <span className="text-[10px] text-gray-500 font-mono">{fb.company.name}</span>
                          </div>
                          <p className="font-medium text-white text-sm">{fb.title}</p>
                          <p className="text-xs text-gray-400 mt-1 line-clamp-2">{fb.description}</p>
                          <p className="text-[10px] text-gray-600 mt-2">
                            {format(new Date(fb.submittedAt), 'dd/MM/yyyy HH:mm', { locale: fr })}
                          </p>
                        </div>
                        <div className="flex flex-col gap-1 shrink-0">
                          {(['new', 'in_progress', 'done', 'rejected'] as const).filter(s => s !== fb.status).map(s => (
                            <button key={s} type="button"
                              onClick={() => updateFeedbackStatus.mutate({ id: fb.id, status: s })}
                              disabled={updateFeedbackStatus.isPending}
                              className="rounded-lg border border-gray-700 px-2 py-1 text-[10px] text-gray-400 hover:text-white hover:border-gray-500 transition-colors disabled:opacity-40">
                              {s === 'new' ? 'Nouveau' : s === 'in_progress' ? 'En cours' : s === 'done' ? 'Résolu' : 'Rejeter'}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Section Super admins ──────────────────────────────────────────── */}
        {activeSection === 'admins' && (
          <div className="flex-1 p-6 overflow-y-auto">
            <div className="max-w-lg">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Super administrateurs</h2>
                <button type="button" onClick={() => setShowAdminForm(true)}
                  className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-white"
                  style={{ backgroundColor: '#01696e' }}>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Ajouter
                </button>
              </div>
              <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
                {admins.length === 0 ? (
                  <p className="py-8 text-center text-sm text-gray-600">Aucun super admin</p>
                ) : admins.map(a => (
                  <div key={a.id} className="flex items-center gap-4 border-b border-gray-800 px-5 py-4 last:border-0">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#01696e]/20 text-sm font-bold text-[#01696e]">
                      {a.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-white">{a.name}</p>
                      <p className="text-sm text-gray-400">{a.email}</p>
                    </div>
                    <p className="text-xs text-gray-600">
                      {format(new Date(a.createdAt), 'dd/MM/yyyy', { locale: fr })}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal création société */}
      {showCompanyForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xl rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4 sticky top-0 bg-gray-900 z-10">
              <h3 className="font-semibold text-white">Nouvelle société</h3>
              <button type="button" onClick={() => setShowCompanyForm(false)} className="text-gray-500 hover:text-gray-300">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={e => { e.preventDefault(); createCompany.mutate(companyForm); }}
              className="p-6 space-y-5">

              {/* Infos générales */}
              <div>
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Informations générales</p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Nom de la société *</label>
                    <input required value={companyForm.name}
                      onChange={e => setCompanyForm(f => ({ ...f, name: e.target.value, slug: slugify(e.target.value) }))}
                      className="w-full rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#01696e]/40" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Plan</label>
                      <select value={companyForm.plan}
                        onChange={e => setCompanyForm(f => ({ ...f, plan: e.target.value as Plan }))}
                        className="w-full rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#01696e]/40">
                        {PLANS.map(p => <option key={p} value={p}>{PLAN_CONFIG[p].label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Durée essai (jours)</label>
                      <input type="number" min={0} max={365} value={companyForm.trialDays}
                        onChange={e => setCompanyForm(f => ({ ...f, trialDays: Number(e.target.value) }))}
                        className="w-full rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#01696e]/40" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Infos pro */}
              <div>
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Informations professionnelles</p>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">SIRET</label>
                      <input value={companyForm.siret}
                        onChange={e => setCompanyForm(f => ({ ...f, siret: e.target.value }))}
                        placeholder="12345678901234"
                        className="w-full rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#01696e]/40" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Nom du gérant</label>
                      <input value={companyForm.managerName}
                        onChange={e => setCompanyForm(f => ({ ...f, managerName: e.target.value }))}
                        className="w-full rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#01696e]/40" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Téléphone</label>
                      <input type="tel" value={companyForm.phone}
                        onChange={e => setCompanyForm(f => ({ ...f, phone: e.target.value }))}
                        placeholder="+33 6 00 00 00 00"
                        className="w-full rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#01696e]/40" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Email de contact</label>
                      <input type="email" value={companyForm.contactEmail}
                        onChange={e => setCompanyForm(f => ({ ...f, contactEmail: e.target.value }))}
                        className="w-full rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#01696e]/40" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Adresse</label>
                    <input value={companyForm.address}
                      onChange={e => setCompanyForm(f => ({ ...f, address: e.target.value }))}
                      className="w-full rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#01696e]/40" />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                      <label className="block text-xs text-gray-400 mb-1">Ville</label>
                      <input value={companyForm.city}
                        onChange={e => setCompanyForm(f => ({ ...f, city: e.target.value }))}
                        className="w-full rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#01696e]/40" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Code postal</label>
                      <input value={companyForm.postalCode}
                        onChange={e => setCompanyForm(f => ({ ...f, postalCode: e.target.value }))}
                        className="w-full rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#01696e]/40" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Config technique (avancé) */}
              <details className="group">
                <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-gray-500 select-none">
                  Configuration technique ▸
                </summary>
                <div className="mt-3 space-y-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Slug (auto-généré)</label>
                    <input required value={companyForm.slug} placeholder="ex: sun-and-drive"
                      onChange={e => setCompanyForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') }))}
                      className="w-full rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-sm font-mono text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#01696e]/40" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">URL base de données tenant *</label>
                    <input required type="url" value={companyForm.tenantDbUrl} placeholder="postgresql://user:pass@host:5432/dbname"
                      onChange={e => setCompanyForm(f => ({ ...f, tenantDbUrl: e.target.value }))}
                      className="w-full rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-sm font-mono text-white focus:outline-none focus:ring-2 focus:ring-[#01696e]/40" />
                  </div>
                </div>
              </details>

              {createCompany.isError && (
                <p className="text-sm text-red-400">Erreur : slug déjà utilisé ou données invalides</p>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowCompanyForm(false)}
                  className="rounded-xl border border-gray-700 px-4 py-2 text-sm text-gray-400 hover:text-white">
                  Annuler
                </button>
                <button type="submit" disabled={createCompany.isPending}
                  className="rounded-xl px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                  style={{ backgroundColor: '#01696e' }}>
                  Créer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal création super admin */}
      {showAdminForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
              <h3 className="font-semibold text-white">Nouveau super admin</h3>
              <button type="button" onClick={() => setShowAdminForm(false)} className="text-gray-500 hover:text-gray-300">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={e => { e.preventDefault(); createAdmin.mutate(adminForm); }}
              className="p-6 space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Nom *</label>
                <input required value={adminForm.name} onChange={e => setAdminForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#01696e]/40" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Email *</label>
                <input required type="email" value={adminForm.email} onChange={e => setAdminForm(f => ({ ...f, email: e.target.value }))}
                  className="w-full rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#01696e]/40" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Mot de passe * (min. 8 car.)</label>
                <input required type="password" minLength={8} value={adminForm.password} onChange={e => setAdminForm(f => ({ ...f, password: e.target.value }))}
                  className="w-full rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#01696e]/40" />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowAdminForm(false)}
                  className="rounded-xl border border-gray-700 px-4 py-2 text-sm text-gray-400 hover:text-white">
                  Annuler
                </button>
                <button type="submit" disabled={createAdmin.isPending}
                  className="rounded-xl px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                  style={{ backgroundColor: '#01696e' }}>
                  Créer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
