import React, { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../../utils/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface VehicleStat {
  vehicule: string; zone: string; annee: number; km: number; scoreSante: number;
  nbLocations: number; caNet: number; kmTotal: number; kmAnnuelPrevu: number;
  incidents: number; entretiensEnAttente: number; ctExpiration: string | null;
}

interface ReportData {
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
    swot: { forces: string[]; faiblesses: string[]; opportunites: string[]; menaces: string[] };
    pestel: { politique: string; economique: string; sociologique: string; technologique: string; environnemental: string; legal: string };
    veille_zones: Array<{ zone: string; trafic_voyageurs: string; perspectives: string; opportunites: string; risques: string }>;
    veille_sectorielle: { autopartage: string; ademe: string; fiscalite: string; marche: string };
    recommandations_ceo: Array<{ priorite: string; action: string; detail: string; echeance: string }>;
    analyse_accessoires: {
      demandes_par_zone: Array<{ zone: string; demandes_siege: number; stock_estime: string }>;
      recommandations: string[];
    };
    error?: string;
  };
}

const LOADING_MESSAGES = [
  'Analyse des données de la flotte...',
  'Recherche des tendances du marché...',
  'Analyse des zones de livraison...',
  'Veille réglementaire en cours...',
  'Rédaction des recommandations...',
];

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

// ─── Composant principal ─────────────────────────────────────────────────────

export default function ReportPage(): React.JSX.Element {
  const [msgIdx, setMsgIdx] = useState(0);
  const [perfView, setPerfView] = useState<'chart' | 'table'>('chart');
  const [generated, setGenerated] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);

  const { data, isFetching, refetch } = useQuery<ReportData>({
    queryKey: ['ceo-report'],
    queryFn: () => api.get<ReportData>('/intelligence/report').then(r => r.data),
    staleTime: 60 * 60 * 1000,
    enabled: false,
  });

  useEffect(() => {
    if (!isFetching) return;
    const timer = setInterval(() => setMsgIdx(i => (i + 1) % LOADING_MESSAGES.length), 3000);
    return () => clearInterval(timer);
  }, [isFetching]);

  function handleGenerate(): void {
    setGenerated(true);
    void refetch();
  }

  const theme = data?.theme ?? { primaryColor: '#01696e', fontFamily: 'Montserrat', logoUrl: null, companyName: 'Sun and Drive' };
  const report = data?.report;
  const internal = data?.internalData;
  const vehicleStats = data?.vehicleStats ?? [];

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });

  const SECTIONS = [
    { id: 'resume', label: 'Résumé' },
    { id: 'performance', label: 'Performance' },
    { id: 'flotte', label: 'Flotte' },
    { id: 'swot', label: 'SWOT' },
    { id: 'pestel', label: 'PESTEL' },
    { id: 'zones', label: 'Zones' },
    { id: 'veille', label: 'Veille' },
    { id: 'reco', label: 'Recommandations' },
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
      <header ref={navRef} className="no-print sticky top-0 z-40 border-b border-gray-200 bg-white shadow-sm">
        <div className="flex h-14 items-center justify-between px-6">
          <div className="flex items-center gap-4">
            {theme.logoUrl && (
              <img src={theme.logoUrl} alt="logo" className="h-7 w-auto object-contain" />
            )}
            <div>
              <h1 className="text-sm font-bold text-gray-900">Rapport CEO</h1>
              {data && (
                <p className="text-[10px] text-gray-400">
                  Généré le {format(new Date(data.generatedAt), 'dd/MM/yyyy à HH:mm', { locale: fr })}
                </p>
              )}
            </div>
            {data && (
              <nav className="hidden md:flex items-center gap-0.5 ml-4">
                {SECTIONS.map(s => (
                  <button key={s.id} type="button" onClick={() => scrollTo(s.id)}
                    className="rounded-lg px-2.5 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors">
                    {s.label}
                  </button>
                ))}
              </nav>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={handleGenerate} disabled={isFetching}
              className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 transition-opacity"
              style={{ backgroundColor: theme.primaryColor }}>
              {isFetching ? (
                <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : '✨'}
              {isFetching ? 'Génération...' : 'Générer'}
            </button>
            {data && (
              <button type="button" onClick={() => window.print()}
                className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                📄 PDF
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 space-y-8">
        {/* État initial */}
        {!generated && !isFetching && !data && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="text-6xl mb-6">📊</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">Rapport CEO</h2>
            <p className="text-gray-500 max-w-md mb-2">
              Analyse complète de la flotte, SWOT, PESTEL et recommandations stratégiques
              enrichies d'une veille externe en temps réel.
            </p>
            <button type="button" onClick={handleGenerate}
              className="mt-6 rounded-2xl px-8 py-3 text-base font-semibold text-white shadow-lg transition-transform hover:scale-105"
              style={{ backgroundColor: theme.primaryColor }}>
              ✨ Générer le rapport
            </button>
            <p className="mt-3 text-xs text-gray-400">30 à 60 secondes — recherche de données externes en cours</p>
          </div>
        )}

        {/* État loading */}
        {isFetching && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="mb-6 h-12 w-12 animate-spin rounded-full border-4 border-t-transparent"
              style={{ borderColor: theme.primaryColor, borderTopColor: 'transparent' }} />
            <p className="text-base font-medium text-gray-700 transition-all">{LOADING_MESSAGES[msgIdx]}</p>
            <p className="mt-2 text-xs text-gray-400">30 à 60 secondes — recherche de données externes en cours</p>
          </div>
        )}

        {/* Rapport généré */}
        {data && report && internal && (
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

              {/* KPI cards */}
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

              {/* Switch chart/table */}
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
                      <Bar dataKey="ca" fill={theme.primaryColor} radius={[4, 4, 0, 0]} />
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
              <h2 className="text-lg font-bold text-gray-900">Flotte & Interventions</h2>

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
                      {((report.swot[key as keyof typeof report.swot]) as string[]).map((item, i) => (
                        <li key={i} className={`text-sm ${dot.replace('text-', 'text-gray-')}`}>
                          <span className={dot}>• </span>{item}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>

            {/* PESTEL */}
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
                    <h3 className="mb-2 text-sm font-semibold text-gray-900">
                      {icon} {label}
                    </h3>
                    <p className="text-sm text-gray-600 leading-relaxed">
                      {report.pestel[key as keyof typeof report.pestel]}
                    </p>
                  </div>
                ))}
              </div>
            </section>

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
                      {report.veille_sectorielle[key as keyof typeof report.veille_sectorielle]}
                    </p>
                  </div>
                ))}
              </div>
            </section>

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
              {format(new Date(data.generatedAt), 'dd/MM/yyyy à HH:mm', { locale: fr })}
            </footer>
          </>
        )}
      </main>
    </div>
  );
}
