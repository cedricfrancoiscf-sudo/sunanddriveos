import React, { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ComposedChart, Line, ReferenceLine, Cell,
} from 'recharts';
import { api } from '../../utils/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface EncaisseBreakdown {
  total: number; basePrice: number; insuranceFee: number;
  driverMessFee: number; damageCompensation: number; autres: number;
}
interface MonthData {
  month: string; label: string;
  encaisse: EncaisseBreakdown;
  previsionnel: number; total: number; rentalCount: number; km: number;
}
interface AnnualKPIs {
  totalEncaisse: number; totalPrevisionnel: number; totalCA: number;
  rentalCount: number; occupancyRate: number; totalKm: number; vehicleCount: number;
  monthlyData: MonthData[];
}

interface MonthlyPerf {
  month: string; ca: number; encaisse: number; previsionnel: number;
  occupancy: number; count: number; km: number;
}
interface VehiclePerf {
  vehicleId: string; make: string; model: string; licensePlate: string; label: string;
  totalPayout: number; totalEncaisse: number; totalPrevisionnel: number;
  totalGross: number; totalInsurance: number;
  rentalCount: number; avgDuration: number; avgKmPerRental: number;
  occupancyRate: number; incidentCount: number; extraFeesRate: number;
  healthScore: number; monthlyCA: MonthlyPerf[];
}

interface ChatMsg { role: 'user' | 'ai'; content: string; }

// ── Couleurs ──────────────────────────────────────────────────────────────────

const VEHICLE_COLORS = ['#01696e','#3b82f6','#f59e0b','#ef4444','#8b5cf6','#10b981','#f97316','#06b6d4'];

function fmtEuro(v: number): string {
  return v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
}

function HealthBar({ score }: { score: number }): React.JSX.Element {
  const color = score >= 75 ? '#16a34a' : score >= 50 ? '#f59e0b' : '#ef4444';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-gray-100">
        <div className="h-full rounded-full" style={{ width: `${score}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs font-semibold" style={{ color }}>{score}</span>
    </div>
  );
}

const SUGGESTED_QUESTIONS = [
  'Quelle est ma voiture la plus rentable ?',
  'Quel lieu rapporte le plus ?',
  'Quel est mon meilleur mois ?',
  "Taux d'occupation par voiture ?",
  'Quel véhicule a le plus de km ?',
];

// ── Tooltip CA mensuel décomposé ──────────────────────────────────────────────

function CATooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ payload: MonthData }>; label?: string }): React.JSX.Element | null {
  if (!active || !payload?.length) return null;
  const d: MonthData | undefined = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-lg text-xs min-w-[200px]">
      <p className="font-semibold text-gray-900 mb-1">{label} — {d.rentalCount} location{d.rentalCount !== 1 ? 's' : ''}</p>
      <div className="space-y-0.5 border-t border-gray-100 pt-1">
        <p className="flex justify-between"><span className="text-green-700">Location</span><span>{fmtEuro(d.encaisse.basePrice)}</span></p>
        <p className="flex justify-between"><span className="text-emerald-700">Assurance</span><span>{fmtEuro(d.encaisse.insuranceFee)}</span></p>
        <p className="flex justify-between"><span className="text-yellow-700">Nettoyage</span><span>{fmtEuro(d.encaisse.driverMessFee)}</span></p>
        <p className="flex justify-between"><span className="text-orange-700">Réparations</span><span>{fmtEuro(d.encaisse.damageCompensation)}</span></p>
        <p className="flex justify-between"><span className="text-stone-600">Autres</span><span>{fmtEuro(d.encaisse.autres)}</span></p>
        <p className="flex justify-between font-semibold border-t border-gray-100 pt-0.5 mt-0.5"><span className="text-green-800">Total encaissé</span><span>{fmtEuro(d.encaisse.total)}</span></p>
        {d.previsionnel > 0 && <p className="flex justify-between text-blue-600"><span>Prévisionnel</span><span>{fmtEuro(d.previsionnel)}</span></p>}
        <p className="flex justify-between text-gray-400"><span>Km</span><span>{d.km.toLocaleString('fr-FR')} km</span></p>
      </div>
    </div>
  );
}

// ── Page principale ────────────────────────────────────────────────────────────

export default function IntelligencePage(): React.JSX.Element {
  const [perfView, setPerfView] = useState<'chart' | 'table'>('chart');
  const [perfMetric, setPerfMetric] = useState<'ca' | 'occupancy'>('ca');
  const [sortKey, setSortKey] = useState('totalPayout');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const { data: annual, isLoading: annualLoading } = useQuery<AnnualKPIs>({
    queryKey: ['intelligence-annual'],
    queryFn: () => api.get<AnnualKPIs>('/intelligence/annual-kpis').then(r => r.data),
    staleTime: 5 * 60_000,
  });

  const { data: perfData, isLoading: perfLoading } = useQuery<{ performance: VehiclePerf[] }>({
    queryKey: ['intelligence-performance'],
    queryFn: () => api.get<{ performance: VehiclePerf[] }>('/intelligence/performance').then(r => r.data),
    staleTime: 5 * 60_000,
  });

  const chatMutation = useMutation({
    mutationFn: (q: string) => api.post<{ answer: string }>('/intelligence/chat', { question: q }).then(r => r.data.answer),
    onSuccess: (a) => setMessages(p => [...p, { role: 'ai', content: a }]),
  });
  function sendChat(q: string): void {
    if (!q.trim()) return;
    setMessages(p => [...p, { role: 'user', content: q }]);
    setChatInput('');
    chatMutation.mutate(q);
  }

  const performance = perfData?.performance ?? [];
  const avgPayout = performance.length > 0 ? performance.reduce((s, v) => s + v.totalPayout, 0) / performance.length : 0;

  // Mois disponibles pour l'axe X (6 derniers mois)
  const allMonths = performance.length > 0 && performance[0]
    ? performance[0].monthlyCA.map(m => m.month)
    : [];
  const FR_M = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
  const monthLabel = (m: string) => FR_M[parseInt(m.split('-')[1] ?? '1') - 1] ?? m;

  // Données pour le graphique par véhicule par mois (CA)
  const caByMonthData = allMonths.map(month => {
    const entry: Record<string, string | number> = { month: monthLabel(month) };
    performance.forEach((v, i) => {
      const mp = v.monthlyCA.find(m => m.month === month);
      entry[`v${i}`] = mp?.ca ?? 0;
    });
    return entry;
  });

  // Données pour le taux d'occupation par véhicule par mois
  const occByMonthData = allMonths.map(month => {
    const entry: Record<string, string | number> = { month: monthLabel(month) };
    performance.forEach((v, i) => {
      const mp = v.monthlyCA.find(m => m.month === month);
      entry[`v${i}`] = mp?.occupancy ?? 0;
    });
    return entry;
  });

  const sortedPerf = [...performance].sort((a, b) => {
    const av = (a as unknown as Record<string, unknown>)[sortKey];
    const bv = (b as unknown as Record<string, unknown>)[sortKey];
    const n = typeof av === 'number' && typeof bv === 'number' ? av - bv : 0;
    return sortDir === 'desc' ? -n : n;
  });
  function toggleSort(k: string) {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('desc'); }
  }
  const SortBtn = ({ k, label }: { k: string; label: string }) => (
    <button type="button" onClick={() => toggleSort(k)}
      className="flex items-center gap-0.5 text-xs font-semibold text-gray-500 hover:text-gray-800">
      {label}{sortKey === k && <span className="text-[10px]">{sortDir === 'desc' ? ' ↓' : ' ↑'}</span>}
    </button>
  );

  const avgOccupancy = performance.length > 0 ? Math.round(performance.reduce((s, v) => s + v.occupancyRate, 0) / performance.length) : 0;

  return (
    <div className="p-4 lg:p-6 max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Intelligence ✨</h1>
        <p className="text-sm text-gray-500">Analyse annuelle, performance par véhicule et assistant IA</p>
      </div>

      {/* ── SECTION 1 : KPIs ANNUELS ──────────────────────────────────────── */}
      {annualLoading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[1,2,3,4].map(i => <div key={i} className="h-28 rounded-2xl bg-gray-100 animate-pulse" />)}
        </div>
      ) : annual && (
        <div>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Année {new Date().getFullYear()} — cumulé</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium text-gray-500">CA annuel</p>
              <p className="mt-1 text-xl font-bold text-green-700">{fmtEuro(annual.totalEncaisse)}</p>
              {annual.totalPrevisionnel > 0 && <p className="text-xs font-medium text-blue-600 mt-0.5">+ {fmtEuro(annual.totalPrevisionnel)} prévu</p>}
              <p className="text-[10px] text-gray-400 mt-1">Total : {fmtEuro(annual.totalCA)}</p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium text-gray-500">Taux d'occupation</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">{annual.occupancyRate}%</p>
              <p className="text-xs text-gray-400">{annual.vehicleCount} véhicule{annual.vehicleCount !== 1 ? 's' : ''}</p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium text-gray-500">Locations</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">{annual.rentalCount}</p>
              <p className="text-xs text-gray-400">sur l'année</p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium text-gray-500">Km parcourus</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">{annual.totalKm.toLocaleString('fr-FR')}</p>
              <p className="text-xs text-gray-400">sur l'année</p>
            </div>
          </div>
        </div>
      )}

      {/* ── SECTION 2 : HISTOGRAMME CA MENSUEL DÉCOMPOSÉ ────────────────── */}
      {annual && (
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
            <h2 className="text-sm font-semibold text-gray-900">CA mensuel — {new Date().getFullYear()}</h2>
            <div className="flex flex-wrap items-center gap-3 text-[10px] text-gray-400">
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-green-600 inline-block" /> Location</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500 inline-block" /> Assurance</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-yellow-400 inline-block" /> Nettoyage</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-orange-400 inline-block" /> Réparations</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-stone-400 inline-block" /> Autres</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-blue-400 inline-block" /> Prévisionnel</span>
              <span className="flex items-center gap-1"><span className="h-0.5 w-4 bg-orange-400 inline-block" /> Km</span>
            </div>
          </div>
          <div className="p-5">
            {annual.monthlyData.length > 0 ? (
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={annual.monthlyData} margin={{ top: 10, right: 50, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="ca" tick={{ fontSize: 11 }} tickFormatter={v => `${v}€`} />
                  <YAxis yAxisId="km" orientation="right" tick={{ fontSize: 10 }} tickFormatter={v => `${v}km`} />
                  <Tooltip content={<CATooltip />} />
                  <Bar yAxisId="ca" dataKey="encaisse.basePrice" stackId="ca" fill="#16a34a" name="Location" />
                  <Bar yAxisId="ca" dataKey="encaisse.insuranceFee" stackId="ca" fill="#10b981" name="Assurance" />
                  <Bar yAxisId="ca" dataKey="encaisse.driverMessFee" stackId="ca" fill="#eab308" name="Nettoyage" />
                  <Bar yAxisId="ca" dataKey="encaisse.damageCompensation" stackId="ca" fill="#f97316" name="Réparations" />
                  <Bar yAxisId="ca" dataKey="encaisse.autres" stackId="ca" fill="#a8a29e" name="Autres" />
                  <Bar yAxisId="ca" dataKey="previsionnel" stackId="ca" fill="#60a5fa" radius={[3,3,0,0]} name="Prévisionnel" />
                  <Line yAxisId="km" type="monotone" dataKey="km" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} name="Km" />
                </ComposedChart>
              </ResponsiveContainer>
            ) : <p className="py-10 text-center text-sm text-gray-400">Aucune donnée pour l'année en cours</p>}
          </div>
        </div>
      )}

      {/* ── SECTION 3 : PERFORMANCE PAR VÉHICULE ────────────────────────── */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3 gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Performance par véhicule — 6 mois</h2>
            <p className="text-xs text-gray-400">Identifié par immatriculation</p>
          </div>
          <div className="flex gap-1 flex-wrap">
            <div className="flex gap-1 rounded-lg border border-gray-200 bg-gray-50 p-0.5">
              <button type="button" onClick={() => setPerfView('chart')}
                className={`rounded px-3 py-1 text-xs font-medium transition ${perfView === 'chart' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
                📊 Graphique
              </button>
              <button type="button" onClick={() => setPerfView('table')}
                className={`rounded px-3 py-1 text-xs font-medium transition ${perfView === 'table' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
                📋 Tableau
              </button>
            </div>
            {perfView === 'chart' && (
              <div className="flex gap-1 rounded-lg border border-gray-200 bg-gray-50 p-0.5">
                <button type="button" onClick={() => setPerfMetric('ca')}
                  className={`rounded px-3 py-1 text-xs font-medium transition ${perfMetric === 'ca' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
                  CA
                </button>
                <button type="button" onClick={() => setPerfMetric('occupancy')}
                  className={`rounded px-3 py-1 text-xs font-medium transition ${perfMetric === 'occupancy' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
                  Occupation
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="p-5">
          {perfLoading ? (
            <div className="flex justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" style={{ borderColor: '#01696e', borderTopColor: 'transparent' }} />
            </div>
          ) : perfView === 'chart' && performance.length > 0 ? (
            <>
              <div className="mb-2 flex flex-wrap gap-3 text-[11px]">
                {performance.map((v, i) => (
                  <span key={v.vehicleId} className="flex items-center gap-1 text-gray-600">
                    <span className="h-2.5 w-2.5 rounded-sm inline-block" style={{ backgroundColor: VEHICLE_COLORS[i % VEHICLE_COLORS.length] }} />
                    {v.licensePlate}
                  </span>
                ))}
              </div>
              {perfMetric === 'ca' ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={caByMonthData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${v}€`} />
                    <ReferenceLine y={avgPayout / 6} stroke="#94a3b8" strokeDasharray="4 4"
                      label={{ value: `Moy. ${fmtEuro(avgPayout / 6)}/mois`, position: 'right', fontSize: 9, fill: '#94a3b8' }} />
                    <Tooltip formatter={(v: number, name: string) => {
                      const idx = parseInt(name.replace('v', ''));
                      const veh = performance[idx];
                      return [fmtEuro(v), veh ? `${veh.make} ${veh.model} — ${veh.licensePlate}` : name];
                    }} />
                    {performance.map((_, i) => (
                      <Bar key={i} dataKey={`v${i}`} fill={VEHICLE_COLORS[i % VEHICLE_COLORS.length]} radius={[2,2,0,0]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={occByMonthData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} domain={[0, 100]} />
                    <ReferenceLine y={70} stroke="#f59e0b" strokeDasharray="4 4"
                      label={{ value: 'Objectif 70%', position: 'right', fontSize: 9, fill: '#f59e0b' }} />
                    <ReferenceLine y={avgOccupancy} stroke="#94a3b8" strokeDasharray="4 4"
                      label={{ value: `Moy. ${avgOccupancy}%`, position: 'insideTopRight', fontSize: 9, fill: '#94a3b8' }} />
                    <Tooltip formatter={(v: number, name: string) => {
                      const idx = parseInt(name.replace('v', ''));
                      const veh = performance[idx];
                      return [`${v}%`, veh ? `${veh.make} ${veh.model} — ${veh.licensePlate}` : name];
                    }} />
                    {performance.map((v, i) => (
                      <Bar key={i} dataKey={`v${i}`} radius={[2,2,0,0]}>
                        {occByMonthData.map((entry, j) => {
                          const val = entry[`v${i}`] as number;
                          const fill = val >= 70 ? '#16a34a' : val >= 50 ? '#f59e0b' : '#ef4444';
                          return <Cell key={j} fill={fill} />;
                        })}
                      </Bar>
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              )}
            </>
          ) : perfView === 'chart' ? (
            <p className="py-12 text-center text-sm text-gray-400">Aucune donnée</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="pb-2 text-left text-xs font-semibold text-gray-500">Immatriculation</th>
                    <th className="pb-2 text-left text-xs font-semibold text-gray-500">Modèle</th>
                    <th className="pb-2 text-right"><SortBtn k="totalEncaisse" label="CA encaissé" /></th>
                    <th className="pb-2 text-right"><SortBtn k="totalPrevisionnel" label="CA prév." /></th>
                    <th className="pb-2 text-right"><SortBtn k="totalPayout" label="Total CA" /></th>
                    <th className="pb-2 text-right"><SortBtn k="rentalCount" label="Locations" /></th>
                    <th className="pb-2 text-right"><SortBtn k="occupancyRate" label="Occupation" /></th>
                    <th className="pb-2 text-right"><SortBtn k="avgKmPerRental" label="Km moy" /></th>
                    <th className="pb-2 text-right"><SortBtn k="healthScore" label="Santé" /></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedPerf.map(v => (
                    <tr key={v.vehicleId} className="border-b border-gray-50 last:border-0">
                      <td className="py-2.5">
                        <span className="rounded-md bg-gray-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-gray-700">{v.licensePlate}</span>
                      </td>
                      <td className="py-2.5 text-xs text-gray-600">{v.make} {v.model}</td>
                      <td className="py-2.5 text-right text-xs font-semibold text-green-700">{fmtEuro(v.totalEncaisse)}</td>
                      <td className="py-2.5 text-right text-xs font-medium text-blue-600">{fmtEuro(v.totalPrevisionnel)}</td>
                      <td className="py-2.5 text-right">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${v.totalPayout >= 500 ? 'bg-green-100 text-green-700' : v.totalPayout >= 200 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'}`}>
                          {fmtEuro(v.totalPayout)}
                        </span>
                      </td>
                      <td className="py-2.5 text-right text-xs text-gray-600">{v.rentalCount}</td>
                      <td className="py-2.5 text-right text-xs text-gray-600">{v.occupancyRate}%</td>
                      <td className="py-2.5 text-right text-xs text-gray-600">{v.avgKmPerRental} km</td>
                      <td className="py-2.5 text-right"><HealthBar score={v.healthScore} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── SECTION 5 : ASSISTANT IA ──────────────────────────────────────── */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-gray-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-900">Assistant IA ✨</h2>
          <p className="text-xs text-gray-400">Posez vos questions sur la flotte — données 12 mois</p>
        </div>
        <div className="flex flex-wrap gap-2 border-b border-gray-100 px-5 py-3">
          {SUGGESTED_QUESTIONS.map(q => (
            <button key={q} type="button" onClick={() => sendChat(q)} disabled={chatMutation.isPending}
              className="rounded-full border border-[#01696e]/20 bg-[#01696e]/5 px-3 py-1 text-xs text-[#01696e] hover:bg-[#01696e]/10 disabled:opacity-50 transition">
              {q}
            </button>
          ))}
        </div>
        <div className="h-64 overflow-y-auto px-5 py-3 space-y-3">
          {messages.length === 0 && <p className="py-8 text-center text-sm text-gray-400">Posez une question ci-dessous ou cliquez sur une suggestion</p>}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {m.role === 'ai' && <span className="mr-2 mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#01696e]/10 text-xs">✨</span>}
              <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${m.role === 'user' ? 'bg-[#01696e] text-white' : 'border border-gray-200 bg-gray-50 text-gray-800'}`}>
                {m.content}
              </div>
            </div>
          ))}
          {chatMutation.isPending && (
            <div className="flex justify-start">
              <span className="mr-2 mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#01696e]/10 text-xs">✨</span>
              <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-2.5">
                <div className="flex gap-1">{[0,1,2].map(i => <div key={i} className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />)}</div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
        <div className="border-t border-gray-100 px-5 py-3">
          <form onSubmit={e => { e.preventDefault(); sendChat(chatInput); }} className="flex gap-2">
            <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)}
              placeholder="Votre question..." disabled={chatMutation.isPending}
              className="flex-1 rounded-xl border border-gray-200 px-4 py-2 text-sm outline-none focus:border-[#01696e] disabled:opacity-50" />
            <button type="submit" disabled={!chatInput.trim() || chatMutation.isPending}
              className="rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 transition" style={{ backgroundColor: '#01696e' }}>
              Envoyer
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
