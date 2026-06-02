import React, { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import { api } from '../../utils/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface KPIs {
  ownerPayout: number;
  grossRevenue: number;
  insuranceFee: number;
  rentalCount: number;
  evolution: { ownerPayout: number; grossRevenue: number; rentalCount: number };
  occupancyRate: number;
  avgDuration: number;
  avgKmPerRental: number;
  revpar: number;
  extraFeesRate: number;
  totalKm: number;
  fleetHealthScore: number;
  vehicleCount: number;
  alerts: { pendingMaintenances: number; expiringCT: number };
}

interface VehiclePerf {
  vehicleId: string;
  make: string;
  model: string;
  licensePlate: string;
  totalPayout: number;
  totalGross: number;
  totalInsurance: number;
  rentalCount: number;
  avgDuration: number;
  avgKmPerRental: number;
  occupancyRate: number;
  incidentCount: number;
  extraFeesRate: number;
  healthScore: number;
  monthlyCA: Array<{ month: string; ca: number }>;
}

interface ForecastWeek {
  week: string;
  rentalCount: number;
  totalPayout: number;
}

interface ChatMsg {
  role: 'user' | 'ai';
  content: string;
}

// ── Couleurs chart ─────────────────────────────────────────────────────────────

const CHART_COLORS = ['#01696e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#10b981', '#f97316', '#06b6d4'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtEuro(v: number): string {
  return v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
}

function EvoChip({ pct }: { pct: number }): React.JSX.Element {
  const up = pct >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${up ? 'text-green-600' : 'text-red-500'}`}>
      {up ? '▲' : '▼'} {Math.abs(pct)}%
    </span>
  );
}

function HealthBar({ score }: { score: number }): React.JSX.Element {
  const color = score >= 75 ? '#16a34a' : score >= 50 ? '#f59e0b' : '#ef4444';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-100">
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
  'Combien d\'assurance en 2025 ?',
  'Taux d\'occupation par voiture ?',
];

// ── Page principale ────────────────────────────────────────────────────────────

export default function IntelligencePage(): React.JSX.Element {
  const [perfView, setPerfView] = useState<'chart' | 'table'>('chart');
  const [forecastView, setForecastView] = useState<'chart' | 'table'>('chart');
  const [sortKey, setSortKey] = useState('totalPayout');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // KPIs
  const { data: kpis, isLoading: kpisLoading } = useQuery<KPIs>({
    queryKey: ['intelligence-kpis'],
    queryFn: () => api.get<KPIs>('/intelligence/kpis').then(r => r.data),
    staleTime: 5 * 60_000,
  });

  // Performance
  const { data: perfData, isLoading: perfLoading } = useQuery<{ performance: VehiclePerf[] }>({
    queryKey: ['intelligence-performance'],
    queryFn: () => api.get<{ performance: VehiclePerf[] }>('/intelligence/performance').then(r => r.data),
    staleTime: 5 * 60_000,
  });

  // Forecasts
  const { data: forecastData } = useQuery<{ forecasts: ForecastWeek[]; totalForecast: number }>({
    queryKey: ['intelligence-forecasts'],
    queryFn: () => api.get<{ forecasts: ForecastWeek[]; totalForecast: number }>('/intelligence/forecasts').then(r => r.data),
    staleTime: 5 * 60_000,
  });

  // Briefing IA
  const { data: briefing, isLoading: briefingLoading } = useQuery<string>({
    queryKey: ['intelligence-briefing'],
    queryFn: () => api.post<{ answer: string }>('/intelligence/chat', {
      question: 'Génère un briefing de 3 phrases sur la performance de la flotte ce mois : taux d\'occupation, meilleure voiture, et un point d\'attention.',
    }).then(r => r.data.answer),
    staleTime: 10 * 60_000,
  });

  // Chat
  const chatMutation = useMutation({
    mutationFn: (question: string) =>
      api.post<{ answer: string }>('/intelligence/chat', { question }).then(r => r.data.answer),
    onSuccess: (answer) => {
      setMessages(prev => [...prev, { role: 'ai', content: answer }]);
    },
  });

  function sendChat(question: string): void {
    if (!question.trim()) return;
    setMessages(prev => [...prev, { role: 'user', content: question }]);
    setChatInput('');
    chatMutation.mutate(question);
  }

  // Chart data performance (groupé par mois)
  const performance = perfData?.performance ?? [];
  const allMonths = performance.length > 0 && performance[0]
    ? performance[0].monthlyCA.map(m => m.month)
    : [];
  const perfChartData = allMonths.map(month => {
    const entry: Record<string, string | number> = { month: month.slice(0, 7) };
    performance.forEach(v => {
      const mc = v.monthlyCA.find(m => m.month === month);
      entry[`${v.make} ${v.model}`] = mc?.ca ?? 0;
    });
    return entry;
  });

  // Tableau trié
  const sortedPerf = [...performance].sort((a, b) => {
    const aVal = (a as unknown as Record<string, unknown>)[sortKey];
    const bVal = (b as unknown as Record<string, unknown>)[sortKey];
    const n = typeof aVal === 'number' && typeof bVal === 'number' ? aVal - bVal : 0;
    return sortDir === 'desc' ? -n : n;
  });

  function toggleSort(key: string): void {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  const SortBtn = ({ k, label }: { k: string; label: string }) => (
    <button type="button" onClick={() => toggleSort(k)}
      className="flex items-center gap-0.5 text-xs font-semibold text-gray-500 hover:text-gray-800">
      {label}
      {sortKey === k && <span className="text-[10px]">{sortDir === 'desc' ? ' ↓' : ' ↑'}</span>}
    </button>
  );

  return (
    <div className="p-4 lg:p-6 max-w-6xl space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Intelligence ✨</h1>
        <p className="text-sm text-gray-500">Analyse de performance, prévisions et assistant IA</p>
      </div>

      {/* 4.1 — Briefing IA */}
      <div className="rounded-2xl border border-[#01696e]/20 bg-gradient-to-r from-[#01696e]/5 to-[#0199a1]/5 p-5">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-lg">✨</span>
          <span className="text-sm font-semibold text-[#01696e]">Briefing IA du jour</span>
        </div>
        {briefingLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <div key={i} className="h-3 rounded bg-gray-200 animate-pulse" style={{ width: i === 3 ? '60%' : '100%' }} />)}
          </div>
        ) : (
          <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{briefing}</p>
        )}
      </div>

      {/* 4.2 — KPI Cards */}
      {kpisLoading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-24 rounded-2xl bg-gray-100 animate-pulse" />)}
        </div>
      ) : kpis && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {/* CA net */}
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-gray-500">CA net du mois</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{fmtEuro(kpis.ownerPayout)}</p>
            <EvoChip pct={kpis.evolution.ownerPayout} />
          </div>
          {/* Taux occupation */}
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-gray-500">Taux d'occupation</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{kpis.occupancyRate}%</p>
            <p className="text-xs text-gray-400">{kpis.vehicleCount} véhicule{kpis.vehicleCount !== 1 ? 's' : ''}</p>
          </div>
          {/* Santé flotte */}
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-gray-500">Score santé flotte</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{kpis.fleetHealthScore}<span className="text-sm font-normal text-gray-400">/100</span></p>
            <HealthBar score={kpis.fleetHealthScore} />
          </div>
          {/* RevPAR */}
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-gray-500">RevPAR</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{fmtEuro(kpis.revpar)}</p>
            <p className="text-xs text-gray-400">par véhicule/jour</p>
          </div>
        </div>
      )}

      {/* Alertes */}
      {kpis && (kpis.alerts.pendingMaintenances > 0 || kpis.alerts.expiringCT > 0) && (
        <div className="flex flex-wrap gap-2">
          {kpis.alerts.pendingMaintenances > 0 && (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
              ⚠️ {kpis.alerts.pendingMaintenances} entretien{kpis.alerts.pendingMaintenances > 1 ? 's' : ''} en retard
            </span>
          )}
          {kpis.alerts.expiringCT > 0 && (
            <span className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-medium text-red-700">
              🔴 {kpis.alerts.expiringCT} CT expirant dans 30j
            </span>
          )}
        </div>
      )}

      {/* 4.3 — Performance véhicules */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-900">Performance véhicules — 6 mois</h2>
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
        </div>

        <div className="p-5">
          {perfLoading ? (
            <div className="flex justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" style={{ borderColor: '#01696e', borderTopColor: 'transparent' }} />
            </div>
          ) : perfView === 'chart' ? (
            performance.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={perfChartData} margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${v}€`} />
                  <Tooltip formatter={(v: number) => [`${v.toFixed(0)}€`, '']} />
                  <Legend />
                  {performance.map((v, i) => (
                    <Bar key={v.vehicleId} dataKey={`${v.make} ${v.model}`}
                      fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[2, 2, 0, 0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="py-12 text-center text-sm text-gray-400">Aucune donnée</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="pb-2 text-left text-xs font-semibold text-gray-500">Véhicule</th>
                    <th className="pb-2 text-right"><SortBtn k="totalPayout" label="CA net" /></th>
                    <th className="pb-2 text-right"><SortBtn k="totalGross" label="CA brut" /></th>
                    <th className="pb-2 text-right"><SortBtn k="totalInsurance" label="Assurance" /></th>
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
                        <p className="font-medium text-gray-900">{v.make} {v.model}</p>
                        <p className="text-xs text-gray-400">{v.licensePlate}</p>
                      </td>
                      <td className="py-2.5 text-right">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          v.totalPayout >= 500 ? 'bg-green-100 text-green-700' :
                          v.totalPayout >= 200 ? 'bg-amber-100 text-amber-700' :
                          'bg-red-100 text-red-600'
                        }`}>
                          {fmtEuro(v.totalPayout)}
                        </span>
                      </td>
                      <td className="py-2.5 text-right text-xs text-gray-600">{fmtEuro(v.totalGross)}</td>
                      <td className="py-2.5 text-right text-xs text-gray-600">{fmtEuro(v.totalInsurance)}</td>
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

      {/* 4.4 — Prévisions 30 jours */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Prévisions 30 jours</h2>
            {forecastData && (
              <p className="text-xs text-gray-400">
                Total prévu : <span className="font-semibold text-gray-700">{fmtEuro(forecastData.totalForecast)}</span>
              </p>
            )}
          </div>
          <div className="flex gap-1 rounded-lg border border-gray-200 bg-gray-50 p-0.5">
            <button type="button" onClick={() => setForecastView('chart')}
              className={`rounded px-3 py-1 text-xs font-medium transition ${forecastView === 'chart' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
              📊 Graphique
            </button>
            <button type="button" onClick={() => setForecastView('table')}
              className={`rounded px-3 py-1 text-xs font-medium transition ${forecastView === 'table' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
              📋 Tableau
            </button>
          </div>
        </div>

        <div className="p-5">
          {!forecastData || forecastData.forecasts.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">Aucune location prévue dans les 30 prochains jours</p>
          ) : forecastView === 'chart' ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={forecastData.forecasts} margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${v}€`} />
                <Tooltip formatter={(v: number) => [`${v.toFixed(0)}€`, 'CA net prévu']} />
                <Bar dataKey="totalPayout" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} name="CA net prévu" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="pb-2 text-left text-xs font-semibold text-gray-500">Semaine</th>
                  <th className="pb-2 text-right text-xs font-semibold text-gray-500">Nb locations</th>
                  <th className="pb-2 text-right text-xs font-semibold text-gray-500">CA net prévu</th>
                </tr>
              </thead>
              <tbody>
                {forecastData.forecasts.map(f => (
                  <tr key={f.week} className="border-b border-gray-50 last:border-0">
                    <td className="py-2.5 font-medium text-gray-900">{f.week}</td>
                    <td className="py-2.5 text-right text-gray-600">{f.rentalCount}</td>
                    <td className="py-2.5 text-right font-semibold text-gray-900">{fmtEuro(f.totalPayout)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* 4.5 — Chat IA */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-gray-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-900">Assistant IA ✨</h2>
          <p className="text-xs text-gray-400">Posez vos questions sur la flotte — données 12 mois</p>
        </div>

        {/* Questions suggérées */}
        <div className="flex flex-wrap gap-2 border-b border-gray-100 px-5 py-3">
          {SUGGESTED_QUESTIONS.map(q => (
            <button key={q} type="button" onClick={() => sendChat(q)}
              disabled={chatMutation.isPending}
              className="rounded-full border border-[#01696e]/20 bg-[#01696e]/5 px-3 py-1 text-xs text-[#01696e] hover:bg-[#01696e]/10 disabled:opacity-50 transition">
              {q}
            </button>
          ))}
        </div>

        {/* Messages */}
        <div className="h-64 overflow-y-auto px-5 py-3 space-y-3">
          {messages.length === 0 && (
            <p className="py-8 text-center text-sm text-gray-400">Posez une question ci-dessous ou cliquez sur une suggestion</p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {m.role === 'ai' && (
                <span className="mr-2 mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#01696e]/10 text-xs">✨</span>
              )}
              <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                m.role === 'user'
                  ? 'bg-[#01696e] text-white'
                  : 'border border-gray-200 bg-gray-50 text-gray-800'
              }`}>
                {m.content}
              </div>
            </div>
          ))}
          {chatMutation.isPending && (
            <div className="flex justify-start">
              <span className="mr-2 mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#01696e]/10 text-xs">✨</span>
              <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-2.5">
                <div className="flex gap-1">
                  {[0, 1, 2].map(i => (
                    <div key={i} className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                  ))}
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="border-t border-gray-100 px-5 py-3">
          <form onSubmit={e => { e.preventDefault(); sendChat(chatInput); }} className="flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              placeholder="Votre question..."
              disabled={chatMutation.isPending}
              className="flex-1 rounded-xl border border-gray-200 px-4 py-2 text-sm outline-none focus:border-[#01696e] disabled:opacity-50"
            />
            <button type="submit" disabled={!chatInput.trim() || chatMutation.isPending}
              className="rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 transition"
              style={{ backgroundColor: '#01696e' }}>
              Envoyer
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
