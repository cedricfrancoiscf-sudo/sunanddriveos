import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../../utils/api';

const CHART_COLORS = ['#01696e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#10b981', '#f97316', '#06b6d4'];

// ─── Annual Types ─────────────────────────────────────────────────────────────

interface VehicleStat {
  vehicule: string; zone: string; annee: number; km: number; scoreSante: number;
  nbLocations: number; caNet: number; kmTotal: number; kmAnnuelPrevu: number;
  incidents: number; entretiensEnAttente: number; ctExpiration: string | null;
}

interface ReportData {
  status: 'ready';
  mode?: 'annual';
  generatedAt: string;
  theme: { primaryColor: string; fontFamily: string; logoUrl: string | null; companyName: string };
  internalData: {
    caNet: number; caBrut: number; tauxOccupation: number; nbLocations: number;
    nbIncidents: number; flotte: number; societe: string;
    evolutionMensuelle: Array<{ mois: string; ca: number }>;
    interventionsAVenir: Array<{ vehicule: string; type: string; echeance: string | null }>;
    ctExpiration: Array<{ vehicule: string; expiration: string }>;
  };
  vehicleStats: VehicleStat[];
  report: {
    resume_executif: string;
    swot: { forces: string[]; faiblesses: string[]; opportunites: string[]; menaces: string[] } | null;
    pestel: { politique: string; economique: string; sociologique: string; technologique: string; environnemental: string; legal: string } | null;
    veille_zones: Array<{ zone: string; trafic_voyageurs: string; perspectives: string; opportunites: string; risques: string }>;
    veille_sectorielle: { autopartage: string; ademe: string; fiscalite: string; marche: string } | null;
    recommandations_ceo: Array<{ priorite: string; action: string; detail: string; echeance: string }>;
    analyse_accessoires: {
      demandes_par_zone: Array<{ zone: string; demandes_siege: number; stock_estime: string }>;
      recommandations: string[];
    } | null;
  };
}

// ─── Monthly Types ────────────────────────────────────────────────────────────

interface ComparaisonMetric {
  mois_courant: { label: string; valeur: number; evolution_pct_m1: number; evolution_pct_n1: number };
  m_moins_1: { label: string; valeur: number };
  m_moins_2: { label: string; valeur: number };
  n_moins_1: { label: string; valeur: number };
}

interface MonthlyReportData {
  status: 'ready';
  mode: 'monthly';
  generatedAt: string;
  theme: { primaryColor: string; fontFamily: string; logoUrl: string | null; companyName: string };
  resume_mensuel: { titre: string; synthese: string; points_forts: string[]; points_attention: string[] };
  comparaison: { ca: ComparaisonMetric; taux_occupation: ComparaisonMetric; locations: ComparaisonMetric; km: ComparaisonMetric };
  analyse_vehicules: Array<{ vehicule: string; ca_mois: number; evolution_vs_m1: number; taux_occupation: number; tendance: 'hausse' | 'stable' | 'baisse'; commentaire: string }>;
  alertes_operationnelles: Array<{ type: 'ct' | 'siege_auto' | 'message' | 'anomalie'; priorite: 'haute' | 'moyenne' | 'basse'; titre: string; detail: string }>;
  previsionnel_mois_suivant: { ca_estime: number; nb_reservations_confirmees: number; commentaire: string };
  recommandations: Array<{ priorite: 'haute' | 'moyenne' | 'basse'; titre: string; detail: string; echeance: string }>;
}

type StatusResponse = { status: 'generating' | 'error' | 'absent' };
type AnnualResponse = StatusResponse | ReportData;
type MonthlyResponse = StatusResponse | MonthlyReportData;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const FR_MONTHS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

function shiftMonth(m: string, delta: number): string {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y!, mo! - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function fmtMonth(m: string): string {
  const [y, mo] = m.split('-').map(Number);
  return `${FR_MONTHS[mo! - 1]} ${y}`;
}

const HEALTH_COLOR = (score: number) =>
  score >= 80 ? 'bg-green-100 text-green-700' :
  score >= 50 ? 'bg-yellow-100 text-yellow-700' :
  'bg-red-100 text-red-700';

const PRIORITY_COLOR = (p: string) =>
  p === 'haute' ? 'bg-red-100 text-red-700' :
  p === 'moyenne' ? 'bg-orange-100 text-orange-700' :
  'bg-gray-100 text-gray-500';

const STOCK_COLOR = (s: string) =>
  s === 'suffisant' ? 'bg-green-100 text-green-700' :
  s === 'insuffisant' ? 'bg-red-100 text-red-700' :
  'bg-yellow-100 text-yellow-700';

const ALERT_TYPE_ICON: Record<string, string> = {
  ct: '🔧', siege_auto: '🪑', message: '💬', anomalie: '⚠️',
};

const TENDANCE_ICON = (t: string) => t === 'hausse' ? '↑' : t === 'baisse' ? '↓' : '→';
const TENDANCE_COLOR = (t: string) =>
  t === 'hausse' ? 'text-green-600' : t === 'baisse' ? 'text-red-500' : 'text-gray-400';

function EvolBadge({ pct, unit = '%' }: { pct: number; unit?: string }) {
  const positive = pct >= 0;
  return (
    <span className={`text-xs font-medium ${positive ? 'text-green-600' : 'text-red-500'}`}>
      {positive ? '+' : ''}{pct}{unit}
    </span>
  );
}

// ─── Monthly View ─────────────────────────────────────────────────────────────

function ComparaisonRow({ label, metric, unit = '€', isPoints = false }: {
  label: string;
  metric: ComparaisonMetric;
  unit?: string;
  isPoints?: boolean;
}) {
  const fmt = (v: number) => unit === '€'
    ? `${v.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €`
    : unit === '%' ? `${v} %` : v.toLocaleString('fr-FR');

  return (
    <tr className="border-b border-gray-50">
      <td className="px-4 py-3 text-sm font-medium text-gray-700">{label}</td>
      <td className="px-4 py-3 text-right">
        <div className="text-sm font-bold text-gray-900">{fmt(metric.mois_courant.valeur)}</div>
        <div className="flex justify-end gap-2 mt-0.5">
          <EvolBadge pct={metric.mois_courant.evolution_pct_m1} unit={isPoints ? 'pt' : '%'} />
          <span className="text-xs text-gray-300">|</span>
          <EvolBadge pct={metric.mois_courant.evolution_pct_n1} unit={isPoints ? 'pt' : '%'} />
        </div>
      </td>
      <td className="px-4 py-3 text-right text-sm text-gray-500">{fmt(metric.m_moins_1.valeur)}</td>
      <td className="px-4 py-3 text-right text-sm text-gray-500">{fmt(metric.m_moins_2.valeur)}</td>
      <td className="px-4 py-3 text-right text-sm text-gray-500">{fmt(metric.n_moins_1.valeur)}</td>
    </tr>
  );
}

function MonthlyReportView({ data, theme }: { data: MonthlyReportData; theme: { primaryColor: string } }) {
  const { resume_mensuel, comparaison, analyse_vehicules, alertes_operationnelles, previsionnel_mois_suivant, recommandations } = data;
  const col = comparaison.ca;

  return (
    <div className="space-y-8">
      {/* RÉSUMÉ MENSUEL */}
      <section className="page-break rounded-2xl p-8 text-white" style={{ backgroundColor: theme.primaryColor }}>
        <p className="text-xs font-semibold uppercase tracking-widest opacity-70 mb-1">{resume_mensuel.titre}</p>
        <h2 className="text-2xl font-bold mb-4">Bilan mensuel</h2>
        <p className="text-base leading-relaxed opacity-95 mb-6">{resume_mensuel.synthese}</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-xl bg-white/10 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider opacity-70 mb-2">Points forts</p>
            <ul className="space-y-1.5">
              {resume_mensuel.points_forts.map((p, i) => (
                <li key={i} className="text-sm opacity-90 flex gap-2"><span className="opacity-60">✓</span>{p}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl bg-white/10 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider opacity-70 mb-2">Points d'attention</p>
            <ul className="space-y-1.5">
              {resume_mensuel.points_attention.map((p, i) => (
                <li key={i} className="text-sm opacity-90 flex gap-2"><span className="opacity-60">!</span>{p}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* COMPARAISON */}
      <section className="page-break">
        <h2 className="text-lg font-bold text-gray-900 mb-4">Comparaison périodes</h2>
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Indicateur</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">
                  {col.mois_courant.label}
                  <div className="text-[10px] font-normal text-gray-400">vs M-1 | vs N-1</div>
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-400">{col.m_moins_1.label}</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-400">{col.m_moins_2.label}</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-400">{col.n_moins_1.label}</th>
              </tr>
            </thead>
            <tbody>
              <ComparaisonRow label="CA net" metric={comparaison.ca} unit="€" />
              <ComparaisonRow label="Taux occupation" metric={comparaison.taux_occupation} unit="%" isPoints />
              <ComparaisonRow label="Locations" metric={comparaison.locations} unit="nb" />
              <ComparaisonRow label="Km parcourus" metric={comparaison.km} unit="km" />
            </tbody>
          </table>
        </div>
      </section>

      {/* ANALYSE VÉHICULES */}
      {analyse_vehicules.length > 0 && (
        <section className="page-break">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Analyse par véhicule</h2>
          <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  {['Véhicule', 'CA mois', 'Évol. M-1', 'Taux occ.', 'Tendance', 'Commentaire'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {analyse_vehicules.map((v, i) => (
                  <tr key={i} className="border-b border-gray-50 last:border-0">
                    <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{v.vehicule}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{v.ca_mois.toFixed(0)} €</td>
                    <td className="px-4 py-3"><EvolBadge pct={v.evolution_vs_m1} /></td>
                    <td className="px-4 py-3 text-gray-600">{v.taux_occupation} %</td>
                    <td className={`px-4 py-3 font-semibold ${TENDANCE_COLOR(v.tendance)}`}>
                      {TENDANCE_ICON(v.tendance)} {v.tendance}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 max-w-[200px]">{v.commentaire}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ALERTES */}
      {alertes_operationnelles.length > 0 && (
        <section className="page-break">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Alertes opérationnelles</h2>
          <div className="space-y-3">
            {alertes_operationnelles.map((a, i) => (
              <div key={i} className={`rounded-2xl border p-4 ${
                a.priorite === 'haute' ? 'border-red-200 bg-red-50' :
                a.priorite === 'moyenne' ? 'border-orange-200 bg-orange-50' :
                'border-gray-200 bg-gray-50'
              }`}>
                <div className="flex items-start gap-3">
                  <span className="text-xl">{ALERT_TYPE_ICON[a.type] ?? '⚠️'}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_COLOR(a.priorite)}`}>
                        {a.priorite}
                      </span>
                      <p className="font-semibold text-gray-900 text-sm">{a.titre}</p>
                    </div>
                    <p className="text-sm text-gray-600">{a.detail}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* PRÉVISIONNEL */}
      <section className="page-break">
        <h2 className="text-lg font-bold text-gray-900 mb-4">Prévisionnel mois suivant</h2>
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-6">
          <div className="flex flex-wrap gap-6 mb-4">
            <div>
              <p className="text-xs font-medium text-blue-400 mb-0.5">CA estimé</p>
              <p className="text-2xl font-bold text-blue-900">
                {previsionnel_mois_suivant.ca_estime.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-blue-400 mb-0.5">Réservations confirmées</p>
              <p className="text-2xl font-bold text-blue-900">{previsionnel_mois_suivant.nb_reservations_confirmees}</p>
            </div>
          </div>
          <p className="text-sm text-blue-800">{previsionnel_mois_suivant.commentaire}</p>
        </div>
      </section>

      {/* RECOMMANDATIONS */}
      {recommandations.length > 0 && (
        <section className="page-break">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Recommandations</h2>
          <div className="space-y-3">
            {recommandations.map((r, i) => (
              <div key={i} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex items-start gap-3">
                  <span className="shrink-0 text-lg font-bold text-gray-300">{String(i + 1).padStart(2, '0')}</span>
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_COLOR(r.priorite)}`}>
                        {r.priorite}
                      </span>
                      <p className="font-semibold text-gray-900">{r.titre}</p>
                    </div>
                    <p className="text-sm text-gray-600">{r.detail}</p>
                    <p className="mt-1 text-xs text-gray-400">⏱ {r.echeance}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────

export default function ReportPage(): React.JSX.Element {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [mode, setMode] = useState<'annual' | 'monthly'>('annual');
  const [perfView, setPerfView] = useState<'chart' | 'table'>('chart');

  const { data, isFetching, isError, refetch } = useQuery<AnnualResponse | MonthlyResponse>({
    queryKey: ['ceo-report', selectedMonth, mode],
    queryFn: () =>
      api.get<AnnualResponse | MonthlyResponse>('/intelligence/report', { params: { month: selectedMonth, mode } })
         .then(r => r.data),
    staleTime: 30_000,
    retry: 0,
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d || ('status' in d && d.status === 'generating')) return 5_000;
      return false;
    },
  });

  const generateMutation = useMutation({
    mutationFn: (params: { month: string; mode: string }) =>
      api.post<StatusResponse>('/intelligence/report/generate', params).then(r => r.data),
    onSuccess: () => void refetch(),
  });

  const statusStr = !data ? null : ('status' in data && data.status !== 'ready' ? data.status : 'ready');
  const isGenerating = isFetching || statusStr === 'generating' || generateMutation.isPending;

  const isMonthly = data && 'mode' in data && data.mode === 'monthly' && data.status === 'ready';
  const isAnnual  = data && data.status === 'ready' && !isMonthly;

  const reportData = isAnnual ? data as ReportData : null;
  const monthlyData = isMonthly ? data as MonthlyReportData : null;

  const theme = (reportData ?? monthlyData)?.theme
    ?? { primaryColor: '#01696e', fontFamily: 'Montserrat', logoUrl: null, companyName: 'Sun and Drive' };
  const report = reportData?.report;
  const internal = reportData?.internalData;
  const vehicleStats = reportData?.vehicleStats ?? [];

  const generatedAt = (reportData ?? monthlyData)?.generatedAt;

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  const ANNUAL_SECTIONS = [
    { id: 'resume', label: 'Résumé' }, { id: 'performance', label: 'Performance' },
    { id: 'flotte', label: 'Flotte' }, { id: 'swot', label: 'SWOT' },
    { id: 'pestel', label: 'PESTEL' }, { id: 'zones', label: 'Zones' },
    { id: 'veille', label: 'Veille' }, { id: 'reco', label: 'Recommandations' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .page-break { page-break-before: always; }
          body { font-family: ${theme.fontFamily}, sans-serif; }
          @page { margin: 2cm; size: A4; }
        }
      `}</style>

      {/* Header sticky */}
      <header className="no-print sticky top-0 z-40 border-b border-gray-200 bg-white shadow-sm">
        <div className="flex h-14 items-center justify-between px-6">
          <div className="flex items-center gap-4">
            {theme.logoUrl && (
              <img src={theme.logoUrl} alt="logo" className="h-7 w-auto object-contain" />
            )}
            <div>
              <h1 className="text-sm font-bold text-gray-900">Rapport CEO</h1>
              {generatedAt && (
                <p className="text-[10px] text-gray-400">
                  Généré le {format(new Date(generatedAt), 'dd/MM/yyyy à HH:mm', { locale: fr })}
                </p>
              )}
            </div>
            {reportData && (
              <nav className="hidden md:flex items-center gap-0.5 ml-4">
                {ANNUAL_SECTIONS.map(s => (
                  <button key={s.id} type="button" onClick={() => scrollTo(s.id)}
                    data-testid={`section-${s.id}`}
                    className="rounded-lg px-2.5 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors">
                    {s.label}
                  </button>
                ))}
              </nav>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Toggle mode */}
            <div className="no-print flex rounded-xl border border-gray-200 overflow-hidden text-xs font-medium">
              <button type="button"
                onClick={() => setMode('annual')}
                className={`px-3 py-2 transition ${mode === 'annual' ? 'text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
                style={mode === 'annual' ? { backgroundColor: theme.primaryColor } : {}}>
                📋 Annuel
              </button>
              <button type="button"
                onClick={() => setMode('monthly')}
                className={`px-3 py-2 transition ${mode === 'monthly' ? 'text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
                style={mode === 'monthly' ? { backgroundColor: theme.primaryColor } : {}}>
                📊 Mensuel
              </button>
            </div>
            {/* Sélecteur de mois */}
            <div className="no-print flex items-center gap-1 rounded-xl border border-gray-200 bg-gray-50 px-2 py-1">
              <button type="button" aria-label="prev-month" onClick={() => setSelectedMonth(m => shiftMonth(m, -1))}
                className="rounded p-0.5 text-gray-400 hover:text-gray-700 transition">‹</button>
              <span className="text-xs font-medium text-gray-700 min-w-[100px] text-center">
                {fmtMonth(selectedMonth)}
              </span>
              <button type="button" aria-label="next-month"
                onClick={() => setSelectedMonth(m => shiftMonth(m, 1))}
                disabled={selectedMonth >= currentMonth}
                className="rounded p-0.5 text-gray-400 hover:text-gray-700 disabled:opacity-30 transition">›</button>
            </div>
            <button type="button"
              onClick={() => generateMutation.mutate({ month: selectedMonth, mode })}
              disabled={isGenerating}
              className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 transition-opacity"
              style={{ backgroundColor: theme.primaryColor }}>
              {isGenerating ? (
                <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : '✨'}
              {isGenerating ? 'Génération...' : (reportData || monthlyData) ? 'Régénérer' : 'Générer'}
            </button>
            {(reportData || monthlyData) && (
              <button type="button" onClick={() => window.print()}
                className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                📄 PDF
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-8 space-y-8">

        {/* État : absent */}
        {!isGenerating && !reportData && !monthlyData && statusStr !== 'error' && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="text-6xl mb-6">{mode === 'monthly' ? '📊' : '📋'}</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">
              {mode === 'monthly' ? 'Bilan mensuel' : 'Rapport CEO'}
            </h2>
            <p className="text-gray-500 max-w-md mb-2">
              {mode === 'monthly'
                ? 'Comparaison M / M-1 / M-2 / N-1, analyse par véhicule, alertes et prévisionnel.'
                : 'Analyse complète de la flotte, SWOT, PESTEL et recommandations stratégiques.'}
            </p>
            <button type="button" onClick={() => generateMutation.mutate({ month: selectedMonth, mode })}
              className="mt-6 rounded-2xl px-8 py-3 text-base font-semibold text-white shadow-lg transition-transform hover:scale-105"
              style={{ backgroundColor: theme.primaryColor }}>
              ✨ Générer le {mode === 'monthly' ? 'bilan' : 'rapport'} {fmtMonth(selectedMonth)}
            </button>
            <p className="mt-3 text-xs text-gray-400">60 à 120 secondes — génération par IA</p>
          </div>
        )}

        {/* État : génération en cours */}
        {isGenerating && !reportData && !monthlyData && (
          <div data-testid="loading-report" className="flex flex-col items-center justify-center py-24 text-center">
            <div className="mb-6 h-12 w-12 animate-spin rounded-full border-4 border-t-transparent"
              style={{ borderColor: theme.primaryColor, borderTopColor: 'transparent' }} />
            <p className="text-base font-medium text-gray-700">Génération en cours...</p>
            <p className="mt-2 text-xs text-gray-400">L'analyse IA peut prendre 60 à 120 secondes</p>
          </div>
        )}

        {/* État : erreur */}
        {statusStr === 'error' && !isGenerating && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="text-5xl mb-4">⚠️</div>
            <h2 className="text-lg font-bold text-gray-900 mb-2">Erreur de génération</h2>
            <p className="text-sm text-gray-500 max-w-md mb-6">
              {isError ? 'Erreur réseau ou serveur.' : 'La génération IA a échoué. Vérifiez la clé ANTHROPIC_API_KEY.'}
            </p>
            <button type="button" onClick={() => generateMutation.mutate({ month: selectedMonth, mode })}
              className="rounded-2xl px-6 py-2.5 text-sm font-semibold text-white"
              style={{ backgroundColor: theme.primaryColor }}>
              ↺ Régénérer
            </button>
          </div>
        )}

        {/* ── Rapport mensuel ── */}
        {monthlyData && (
          <MonthlyReportView data={monthlyData} theme={theme} />
        )}

        {/* ── Rapport annuel ── */}
        {reportData && report && internal && (
          <>
            {/* RÉSUMÉ EXÉCUTIF */}
            <section id="resume" className="page-break rounded-2xl p-8 text-white"
              style={{ backgroundColor: theme.primaryColor }}>
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest opacity-70">{internal.societe} · 12 derniers mois</p>
                  <h2 className="mt-1 text-2xl font-bold">Résumé exécutif</h2>
                </div>
                {theme.logoUrl && (
                  <img src={theme.logoUrl} alt="logo" className="h-10 w-auto object-contain opacity-90" />
                )}
              </div>
              <p className="text-base leading-relaxed opacity-95">{report.resume_executif}</p>
            </section>

            {/* PERFORMANCE */}
            <section id="performance" className="space-y-4">
              <h2 className="text-lg font-bold text-gray-900">Performance</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: 'CA net', value: `${internal.caNet.toLocaleString('fr-FR')} €` },
                  { label: 'Taux occupation', value: `${internal.tauxOccupation} %` },
                  { label: 'Locations', value: String(internal.nbLocations) },
                  { label: 'Incidents', value: String(internal.nbIncidents) },
                ].map(kpi => (
                  <div key={kpi.label} className="rounded-2xl border border-gray-200 bg-white p-5 text-center shadow-sm">
                    <p className="text-2xl font-bold text-gray-900">{kpi.value}</p>
                    <p className="text-xs text-gray-400 mt-1">{kpi.label}</p>
                  </div>
                ))}
              </div>
              <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-gray-700">CA mensuel net (12 mois)</h3>
                  <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                    <button type="button" onClick={() => setPerfView('chart')}
                      className={`px-3 py-1 text-xs font-medium ${perfView === 'chart' ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                      Graphique
                    </button>
                    <button type="button" onClick={() => setPerfView('table')}
                      className={`px-3 py-1 text-xs font-medium ${perfView === 'table' ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                      Tableau
                    </button>
                  </div>
                </div>
                {perfView === 'chart' ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={internal.evolutionMensuelle} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
                      <XAxis dataKey="mois" tick={{ fontSize: 10 }} tickFormatter={v => v.slice(5)} />
                      <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${(v as number / 1000).toFixed(0)}k`} />
                      <Tooltip formatter={(v: number) => [`${v.toFixed(0)} €`, 'CA net']} />
                      <Bar dataKey="ca" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100">
                          <th className="py-2 text-left text-xs font-semibold text-gray-500">Mois</th>
                          <th className="py-2 text-right text-xs font-semibold text-gray-500">CA net</th>
                          <th className="py-2 text-right text-xs font-semibold text-gray-500">Évolution</th>
                        </tr>
                      </thead>
                      <tbody>
                        {internal.evolutionMensuelle.map((row, i) => {
                          const prev = internal.evolutionMensuelle[i - 1];
                          const delta = prev ? row.ca - prev.ca : null;
                          return (
                            <tr key={row.mois} className="border-b border-gray-50">
                              <td className="py-2 text-gray-600">{row.mois}</td>
                              <td className="py-2 text-right font-medium text-gray-900">{row.ca.toFixed(0)} €</td>
                              <td className={`py-2 text-right text-xs ${delta === null ? 'text-gray-400' : delta >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                {delta === null ? '—' : `${delta >= 0 ? '+' : ''}${delta.toFixed(0)} €`}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>

            {/* FLOTTE & INTERVENTIONS */}
            <section id="flotte" className="space-y-4 page-break">
              <h2 className="text-lg font-bold text-gray-900">Flotte &amp; Interventions</h2>
              <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      {['Véhicule', 'Zone', 'CA net', 'Loc.', 'Km total', 'Km/an prévu', 'Score', 'Alertes'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {vehicleStats.map(v => (
                      <tr key={v.vehicule} className="border-b border-gray-50 last:border-0">
                        <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{v.vehicule}</td>
                        <td className="px-4 py-3 text-xs text-gray-500">{v.zone}</td>
                        <td className="px-4 py-3 font-medium text-gray-900">{v.caNet.toFixed(0)} €</td>
                        <td className="px-4 py-3 text-gray-600">{v.nbLocations}</td>
                        <td className="px-4 py-3 text-gray-600">{v.kmTotal.toLocaleString('fr-FR')}</td>
                        <td className="px-4 py-3 text-gray-600">{v.kmAnnuelPrevu.toLocaleString('fr-FR')}</td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${HEALTH_COLOR(v.scoreSante)}`}>
                            {v.scoreSante}/100
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {v.entretiensEnAttente > 0 && (
                            <span className="mr-1 inline-flex items-center gap-0.5 text-orange-600">🔧 {v.entretiensEnAttente}</span>
                          )}
                          {v.ctExpiration && new Date(v.ctExpiration) < new Date(Date.now() + 90 * 86_400_000) && (
                            <span className="inline-flex items-center gap-0.5 text-red-600">⚠️ CT</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {internal.interventionsAVenir.length > 0 && (
                <div className="rounded-2xl border border-orange-200 bg-orange-50 p-5">
                  <h3 className="text-sm font-semibold text-orange-800 mb-3">🔧 Interventions à venir</h3>
                  <div className="space-y-1.5">
                    {internal.interventionsAVenir.map((m, i) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span className="text-orange-700">{m.vehicule} — {m.type}</span>
                        <span className="text-xs text-orange-500">
                          {m.echeance ? format(new Date(m.echeance), 'dd/MM/yyyy', { locale: fr }) : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {internal.ctExpiration.length > 0 && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
                  <h3 className="text-sm font-semibold text-red-800 mb-3">⚠️ CT à renouveler</h3>
                  <div className="space-y-1.5">
                    {internal.ctExpiration.map((ct, i) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span className="text-red-700">{ct.vehicule}</span>
                        <span className="text-xs text-red-500">Expire le {format(new Date(ct.expiration), 'dd/MM/yyyy', { locale: fr })}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>

            {/* SWOT */}
            {report.swot && (
              <section id="swot" className="page-break">
                <h2 className="mb-4 text-lg font-bold text-gray-900">Analyse SWOT</h2>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { key: 'forces', label: 'Forces', cls: 'border-green-200 bg-green-50', hdg: 'text-green-800', dot: 'text-green-500' },
                    { key: 'faiblesses', label: 'Faiblesses', cls: 'border-orange-200 bg-orange-50', hdg: 'text-orange-800', dot: 'text-orange-500' },
                    { key: 'opportunites', label: 'Opportunités', cls: 'border-blue-200 bg-blue-50', hdg: 'text-blue-800', dot: 'text-blue-500' },
                    { key: 'menaces', label: 'Menaces', cls: 'border-red-200 bg-red-50', hdg: 'text-red-800', dot: 'text-red-500' },
                  ].map(({ key, label, cls, hdg, dot }) => (
                    <div key={key} className={`rounded-2xl border p-5 ${cls}`}>
                      <h3 className={`mb-3 text-sm font-bold ${hdg}`}>{label}</h3>
                      <ul className="space-y-1.5">
                        {((report.swot?.[key as keyof typeof report.swot]) as string[] ?? []).map((item, i) => (
                          <li key={i} className="text-sm text-gray-700">
                            <span className={dot}>• </span>{item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* PESTEL */}
            {report.pestel && (
              <section id="pestel" className="page-break">
                <h2 className="mb-4 text-lg font-bold text-gray-900">Analyse PESTEL</h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {[
                    { key: 'politique', label: 'Politique', icon: '🏛️' },
                    { key: 'economique', label: 'Économique', icon: '💰' },
                    { key: 'sociologique', label: 'Sociologique', icon: '👥' },
                    { key: 'technologique', label: 'Technologique', icon: '💻' },
                    { key: 'environnemental', label: 'Environnemental', icon: '🌱' },
                    { key: 'legal', label: 'Légal', icon: '⚖️' },
                  ].map(({ key, label, icon }) => (
                    <div key={key} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                      <h3 className="mb-2 text-sm font-semibold text-gray-900">{icon} {label}</h3>
                      <p className="text-sm text-gray-600 leading-relaxed">
                        {report.pestel?.[key as keyof typeof report.pestel] ?? ''}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ZONES */}
            <section id="zones" className="page-break">
              <h2 className="mb-4 text-lg font-bold text-gray-900">Zones de livraison</h2>
              <div className="space-y-4">
                {report.veille_zones.map((z, i) => (
                  <div key={i} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                    <h3 className="mb-3 font-semibold text-gray-900">{z.zone}</h3>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <p className="text-xs font-medium text-gray-400 mb-0.5">Trafic voyageurs</p>
                        <p className="text-sm text-gray-700">{z.trafic_voyageurs}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-gray-400 mb-0.5">Perspectives</p>
                        <p className="text-sm text-gray-700">{z.perspectives}</p>
                      </div>
                      <div className="rounded-xl bg-green-50 p-3">
                        <p className="text-xs font-medium text-green-600 mb-0.5">Opportunités</p>
                        <p className="text-sm text-green-800">{z.opportunites}</p>
                      </div>
                      <div className="rounded-xl bg-red-50 p-3">
                        <p className="text-xs font-medium text-red-500 mb-0.5">Risques</p>
                        <p className="text-sm text-red-800">{z.risques}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* VEILLE SECTORIELLE */}
            {report.veille_sectorielle && (
              <section id="veille" className="page-break">
                <h2 className="mb-4 text-lg font-bold text-gray-900">Veille sectorielle</h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {[
                    { key: 'autopartage', label: 'Autopartage', icon: '🚗' },
                    { key: 'ademe', label: 'ADEME', icon: '🌿' },
                    { key: 'fiscalite', label: 'Fiscalité', icon: '💶' },
                    { key: 'marche', label: 'Marché', icon: '📊' },
                  ].map(({ key, label, icon }) => (
                    <div key={key} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                      <h3 className="mb-2 text-sm font-semibold text-gray-900">{icon} {label}</h3>
                      <p className="text-sm text-gray-600 leading-relaxed">
                        {report.veille_sectorielle?.[key as keyof typeof report.veille_sectorielle] ?? ''}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* RECOMMANDATIONS */}
            <section id="reco" className="page-break">
              <h2 className="mb-4 text-lg font-bold text-gray-900">Recommandations CEO</h2>
              <div className="space-y-3">
                {report.recommandations_ceo.map((r, i) => (
                  <div key={i} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                    <div className="flex items-start gap-3">
                      <span className="shrink-0 text-lg font-bold text-gray-300">{String(i + 1).padStart(2, '0')}</span>
                      <div className="flex-1">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_COLOR(r.priorite)}`}>
                            {r.priorite}
                          </span>
                          <p className="font-semibold text-gray-900">{r.action}</p>
                        </div>
                        <p className="text-sm text-gray-600">{r.detail}</p>
                        <p className="mt-1 text-xs text-gray-400">⏱ {r.echeance}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* ACCESSOIRES */}
            {report.analyse_accessoires && (
              <section className="page-break">
                <h2 className="mb-4 text-lg font-bold text-gray-900">Accessoires par zone</h2>
                <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm mb-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Zone</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Demandes siège</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Stock estimé</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.analyse_accessoires.demandes_par_zone.map((z, i) => (
                        <tr key={i} className="border-b border-gray-50 last:border-0">
                          <td className="px-4 py-3 font-medium text-gray-900">{z.zone}</td>
                          <td className="px-4 py-3 text-gray-600">{z.demandes_siege}</td>
                          <td className="px-4 py-3">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STOCK_COLOR(z.stock_estime)}`}>
                              {z.stock_estime}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {report.analyse_accessoires.recommandations.length > 0 && (
                  <ul className="space-y-1.5">
                    {report.analyse_accessoires.recommandations.map((r, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                        <span className="mt-0.5 text-[#01696e]">•</span>{r}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {/* Pied de page */}
            <footer className="border-t border-gray-200 pt-4 text-center text-xs text-gray-400">
              Rapport généré par SunanddriveOS le{' '}
              {format(new Date(reportData.generatedAt), 'dd/MM/yyyy à HH:mm', { locale: fr })}
            </footer>
          </>
        )}

        {/* Pied de page mensuel */}
        {monthlyData && (
          <footer className="border-t border-gray-200 pt-4 text-center text-xs text-gray-400">
            Bilan mensuel généré par SunanddriveOS le{' '}
            {format(new Date(monthlyData.generatedAt), 'dd/MM/yyyy à HH:mm', { locale: fr })}
          </footer>
        )}
      </div>
    </div>
  );
}
