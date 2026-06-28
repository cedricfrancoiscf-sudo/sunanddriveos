import React, { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ComposedChart, Line, ReferenceLine, Cell,
  ScatterChart, Scatter, ZAxis,
} from 'recharts';
import { api } from '../../utils/api';
import { useAuth } from '../../hooks/useAuth';

interface MileageAnomaly {
  rentalId: string;
  driverName: string;
  vehicleLicensePlate: string;
  kmDriven: number;
  durationDays: number;
  threshold: number;
  startAt: string;
  endAt: string;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface EncaisseBreakdown {
  total: number;
  basePrice: number; insuranceFee: number; driverMessFee: number; damageCompensation: number;
  lateReturnFee: number; gasRefillFee: number; extraDistanceFee: number;
  assistanceFee: number; deliveryFee: number; batteryRechargeFee: number;
  ownerInfractionFee: number; ownerTowFee: number; guaranteeEarning: number;
  otherCompensation: number; cancellationFee: number;
  autres: number;
  getaroundServiceFee: number;
}
interface MonthData {
  month: string; label: string;
  encaisse: EncaisseBreakdown;
  previsionnel: number; total: number; rentalCount: number; km: number;
  costsFixed: number; costsVariable: number; costsTotal: number; margin: number;
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
  occupancyRate: number; occupancyRateCorrected?: number; unavailableDays?: number;
  indispoTypes?: string[];
  incidentCount: number; extraFeesRate: number;
  healthScore: number; monthlyCA: MonthlyPerf[];
}

interface ChatMsg { role: 'user' | 'ai'; content: string; }
interface AiSuggestion { title: string; description: string; type: 'alert' | 'opportunity' | 'info'; priority: 'high' | 'medium' | 'low'; }

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
  const e = d.encaisse;
  const sousTotal = e.basePrice + e.insuranceFee + e.driverMessFee + e.damageCompensation
    + e.lateReturnFee + e.gasRefillFee + e.extraDistanceFee + e.assistanceFee + e.deliveryFee
    + e.batteryRechargeFee + e.ownerInfractionFee + e.ownerTowFee + e.guaranteeEarning
    + e.otherCompensation + e.cancellationFee;
  const commission = Math.abs(e.getaroundServiceFee ?? 0);
  const fmt = fmtEuro;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-lg text-[13px] overflow-y-auto" style={{ width: 360, maxHeight: 500 }}>
      <p className="font-semibold text-gray-900 mb-1">{label} — {d.rentalCount} location{d.rentalCount !== 1 ? 's' : ''}</p>
      <div className="space-y-0.5 border-t border-gray-100 pt-1">
        {e.basePrice > 0 && <p className="flex justify-between"><span style={{ color: '#15803d' }}>Location</span><span>{fmt(e.basePrice)}</span></p>}
        {e.insuranceFee > 0 && <p className="flex justify-between"><span style={{ color: '#0891b2' }}>Assurance</span><span>{fmt(e.insuranceFee)}</span></p>}
        {e.driverMessFee > 0 && <p className="flex justify-between"><span style={{ color: '#d97706' }}>Nettoyage</span><span>{fmt(e.driverMessFee)}</span></p>}
        {e.damageCompensation > 0 && <p className="flex justify-between"><span style={{ color: '#dc2626' }}>Réparations</span><span>{fmt(e.damageCompensation)}</span></p>}
        {e.extraDistanceFee > 0 && <p className="flex justify-between text-gray-600"><span>Km supplémentaires</span><span>{fmt(e.extraDistanceFee)}</span></p>}
        {e.gasRefillFee > 0 && <p className="flex justify-between text-gray-600"><span>Carburant</span><span>{fmt(e.gasRefillFee)}</span></p>}
        {e.lateReturnFee > 0 && <p className="flex justify-between text-gray-600"><span>Retard</span><span>{fmt(e.lateReturnFee)}</span></p>}
        {e.assistanceFee > 0 && <p className="flex justify-between text-gray-600"><span>Assistance</span><span>{fmt(e.assistanceFee)}</span></p>}
        {e.deliveryFee > 0 && <p className="flex justify-between text-gray-600"><span>Livraison</span><span>{fmt(e.deliveryFee)}</span></p>}
        {e.batteryRechargeFee > 0 && <p className="flex justify-between text-gray-600"><span>Recharge batterie</span><span>{fmt(e.batteryRechargeFee)}</span></p>}
        {e.ownerInfractionFee > 0 && <p className="flex justify-between text-gray-600"><span>Infractions</span><span>{fmt(e.ownerInfractionFee)}</span></p>}
        {e.ownerTowFee > 0 && <p className="flex justify-between text-gray-600"><span>Remorquage</span><span>{fmt(e.ownerTowFee)}</span></p>}
        {e.guaranteeEarning > 0 && <p className="flex justify-between text-gray-600"><span>Garantie</span><span>{fmt(e.guaranteeEarning)}</span></p>}
        {e.otherCompensation > 0 && <p className="flex justify-between text-gray-600"><span>Autres compensations</span><span>{fmt(e.otherCompensation)}</span></p>}
        {e.cancellationFee > 0 && <p className="flex justify-between text-gray-600"><span>Annulations</span><span>{fmt(e.cancellationFee)}</span></p>}
        <div className="border-t border-gray-100 pt-0.5 mt-0.5">
          <p className="flex justify-between font-semibold text-gray-700"><span>Sous-total brut</span><span>{fmt(sousTotal)}</span></p>
          {commission > 0 && <p className="flex justify-between font-medium" style={{ color: '#0ea5e9' }}><span>Commission Getaround</span><span>-{fmt(commission)}</span></p>}
        </div>
        <div className="border-t border-gray-100 pt-0.5 mt-0.5">
          {e.total > 0 && <p className="flex justify-between font-bold text-green-700"><span>Votre revenu</span><span>{fmt(e.total)}</span></p>}
          {d.previsionnel > 0 && <p className="flex justify-between text-blue-600"><span>Prévisionnel</span><span>{fmt(d.previsionnel)}</span></p>}
          <p className="flex justify-between text-gray-400"><span>Km</span><span>{d.km.toLocaleString('fr-FR')} km</span></p>
        </div>
        {(d.costsTotal ?? 0) > 0 && (
          <div className="border-t border-gray-100 pt-0.5 mt-0.5 space-y-0.5">
            <p className="flex justify-between text-gray-500"><span>Coûts fixes</span><span>{fmt(d.costsFixed ?? 0)}</span></p>
            <p className="flex justify-between text-gray-500"><span>Coûts variables</span><span>{fmt(d.costsVariable ?? 0)}</span></p>
            <p className="flex justify-between font-medium text-gray-700"><span>Total coûts</span><span>{fmt(d.costsTotal ?? 0)}</span></p>
            <div className="border-t border-gray-100 pt-0.5">
              <p className="flex justify-between font-bold" style={{ color: (d.margin ?? 0) >= 0 ? '#16a34a' : '#dc2626' }}>
                <span>Marge brute</span>
                <span>{(d.margin ?? 0) >= 0 ? '+' : ''}{fmt(d.margin ?? 0)}</span>
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Page principale ────────────────────────────────────────────────────────────

export default function IntelligencePage(): React.JSX.Element {
  const navigate = useNavigate();
  const [perfView, setPerfView] = useState<'chart' | 'table'>('chart');
  const [perfMetric, setPerfMetric] = useState<'ca' | 'occupancy'>('ca');
  const [sortKey, setSortKey] = useState('totalPayout');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  const qc = useQueryClient();

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

  const { data: suggestionsData, isLoading: suggestionsLoading, isFetching: suggestionsFetching } = useQuery<{ suggestions: AiSuggestion[] }>({
    queryKey: ['intelligence-suggestions'],
    queryFn: () => api.get<{ suggestions: AiSuggestion[] }>('/intelligence/suggestions').then(r => r.data),
    staleTime: 24 * 3_600_000,
    retry: false,
  });

  const { data: mileageData } = useQuery<{ anomalies: MileageAnomaly[] }>({
    queryKey: ['mileage-anomalies'],
    queryFn: () => api.get<{ anomalies: MileageAnomaly[] }>('/intelligence/mileage-anomalies').then(r => r.data),
    staleTime: 30 * 60_000,
  });
  const mileageAnomalies = mileageData?.anomalies ?? [];

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

      {/* ── LIENS RAPIDES ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => navigate('/intelligence/ratings')}
          className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:border-[#01696e] hover:text-[#01696e] shadow-sm transition">
          <span>★</span> Notes Getaround
        </button>
        <button type="button" onClick={() => navigate('/intelligence/report')}
          className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:border-[#01696e] hover:text-[#01696e] shadow-sm transition">
          <span>📄</span> Rapport CEO
        </button>
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
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm inline-block" style={{ backgroundColor: '#15803d' }} /> Location</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm inline-block" style={{ backgroundColor: '#0891b2' }} /> Assurance</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm inline-block" style={{ backgroundColor: '#d97706' }} /> Nettoyage</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm inline-block" style={{ backgroundColor: '#dc2626' }} /> Réparations</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm inline-block" style={{ backgroundColor: '#7c3aed' }} /> Autres</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm inline-block" style={{ backgroundColor: '#3b82f6' }} /> Prévisionnel</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm inline-block" style={{ backgroundColor: '#f97316' }} /> Coûts</span>
              <span className="flex items-center gap-1"><span className="h-0.5 w-4 bg-slate-400 inline-block" /> Km</span>
            </div>
          </div>
          <div className="p-5">
            {annual.monthlyData.length > 0 ? (
              <ResponsiveContainer width="100%" height={340}>
                <ComposedChart data={annual.monthlyData} margin={{ top: 24, right: 50, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="ca" tick={{ fontSize: 11 }} tickFormatter={v => `${v}€`} />
                  <YAxis yAxisId="km" orientation="right" tick={{ fontSize: 10 }} tickFormatter={v => `${v}km`} />
                  <Tooltip content={<CATooltip />} />
                  <Bar yAxisId="ca" dataKey="encaisse.basePrice" stackId="monthly" fill="#15803d" name="Location" />
                  <Bar yAxisId="ca" dataKey="encaisse.insuranceFee" stackId="monthly" fill="#0891b2" name="Assurance" />
                  <Bar yAxisId="ca" dataKey="encaisse.driverMessFee" stackId="monthly" fill="#d97706" name="Nettoyage" />
                  <Bar yAxisId="ca" dataKey="encaisse.damageCompensation" stackId="monthly" fill="#dc2626" name="Réparations" />
                  <Bar yAxisId="ca" dataKey="encaisse.autres" stackId="monthly" fill="#7c3aed" name="Autres" />
                  <Bar yAxisId="ca" dataKey="previsionnel" stackId="monthly" fill="#3b82f6" radius={[3,3,0,0]} name="Prévisionnel"
                    label={(props: Record<string, unknown>) => {
                      const { x, y, width, index } = props as { x: number; y: number; width: number; index: number };
                      const d = annual.monthlyData[index];
                      if (!d) return <g />;
                      const margin = d.margin ?? 0;
                      if (margin === 0) return <g />;
                      // Afficher sur mois passés (encaisse > 0, previsionnel = 0 → y est au top de l'encaissé)
                      // et sur mois futurs (encaisse = 0, previsionnel > 0 → y est au top du prévisionnel)
                      return (
                        <text x={(x as number) + (width as number) / 2} y={(y as number) - 8} textAnchor="middle" fontSize={11} fontWeight="bold" fill={margin >= 0 ? '#16a34a' : '#dc2626'}>
                          {margin >= 0 ? '+' : ''}{fmtEuro(margin)}
                        </text>
                      );
                    }}
                  />
                  <Bar yAxisId="ca" dataKey="costsTotal" fill="#f97316" radius={[3,3,0,0]} name="Coûts" />
                  <Line yAxisId="km" type="monotone" dataKey="km" stroke="#94a3b8" strokeWidth={2} dot={{ r: 3 }} name="Km" />
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
                    <th className="pb-2 text-right"><SortBtn k="occupancyRate" label="Occupation brute" /></th>
                    <th className="pb-2 text-right"><SortBtn k="occupancyRateCorrected" label="Occupation corrigée" /></th>
                    <th className="pb-2 text-right text-xs font-semibold text-gray-500">Indispo</th>
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
                      <td className="py-2.5 text-right text-xs text-gray-400">{v.occupancyRate}%</td>
                      <td className="py-2.5 text-right text-xs font-semibold text-gray-700">
                        {v.occupancyRateCorrected != null ? `${v.occupancyRateCorrected}%` : `${v.occupancyRate}%`}
                      </td>
                      <td className="py-2.5 text-right text-xs text-gray-500">
                        {(v.unavailableDays ?? 0) > 0
                          ? <span className="text-amber-600 font-medium">{v.unavailableDays}j</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
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

      {/* ── SECTION 4 : ANOMALIES KILOMÉTRIQUES ─────────────────────────── */}
      {mileageAnomalies.length > 0 && (
        <div className="rounded-2xl border border-orange-200 bg-orange-50 shadow-sm overflow-hidden">
          <div className="border-b border-orange-100 px-5 py-3 flex items-center gap-2">
            <span className="text-base">⚠️</span>
            <div>
              <h2 className="text-sm font-semibold text-orange-800">Anomalies kilométriques</h2>
              <p className="text-xs text-orange-600">{mileageAnomalies.length} location{mileageAnomalies.length > 1 ? 's' : ''} avec km/jour élevés détectée{mileageAnomalies.length > 1 ? 's' : ''}</p>
            </div>
          </div>
          <div className="divide-y divide-orange-100">
            {mileageAnomalies.slice(0, 5).map(a => (
              <div key={a.rentalId} className="flex items-center justify-between px-5 py-3 gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{a.driverName}</p>
                  <p className="text-xs text-gray-500">{a.vehicleLicensePlate} · {new Date(a.startAt).toLocaleDateString('fr-FR')} → {new Date(a.endAt).toLocaleDateString('fr-FR')}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-orange-700">{a.kmDriven.toLocaleString('fr-FR')} km</p>
                  <p className="text-xs text-orange-500">{a.durationDays}j · {Math.round(a.kmDriven / a.durationDays)} km/j</p>
                </div>
              </div>
            ))}
            {mileageAnomalies.length > 5 && (
              <p className="px-5 py-2 text-xs text-orange-500">+ {mileageAnomalies.length - 5} autres anomalies</p>
            )}
          </div>
        </div>
      )}

      {/* ── SECTION 5 : SUGGESTIONS IA ───────────────────────────────────── */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Suggestions IA ✨</h2>
            <p className="text-xs text-gray-400">Recommandations basées sur les données de la flotte</p>
          </div>
          <button type="button"
            onClick={() => { void api.get('/intelligence/suggestions?force=1').then(() => qc.invalidateQueries({ queryKey: ['intelligence-suggestions'] })); }}
            disabled={suggestionsFetching}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition">
            <svg className={`h-3.5 w-3.5 ${suggestionsFetching ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Actualiser
          </button>
        </div>
        <div className="p-5">
          {suggestionsLoading ? (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {[1,2,3,4].map(i => <div key={i} className="h-20 rounded-xl bg-gray-100 animate-pulse" />)}
            </div>
          ) : (suggestionsData?.suggestions ?? []).length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-400">Aucune suggestion disponible</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {(suggestionsData?.suggestions ?? []).map((s, i) => {
                const colors = {
                  alert:       { bg: 'bg-red-50',    border: 'border-red-100',    icon: 'text-red-500',    dot: 'bg-red-400' },
                  opportunity: { bg: 'bg-green-50',  border: 'border-green-100',  icon: 'text-green-600',  dot: 'bg-green-400' },
                  info:        { bg: 'bg-blue-50',   border: 'border-blue-100',   icon: 'text-blue-500',   dot: 'bg-blue-400' },
                };
                const c = colors[s.type] ?? colors.info;
                const priorityLabel = { high: 'Urgent', medium: 'Moyen', low: 'Info' }[s.priority] ?? '';
                return (
                  <div key={i} className={`rounded-xl border p-4 ${c.bg} ${c.border}`}>
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className={`text-xs font-bold ${c.icon}`}>{s.title}</p>
                      <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white ${c.dot}`}>{priorityLabel}</span>
                    </div>
                    <p className="text-xs text-gray-600 leading-relaxed">{s.description}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── SECTION 6 : ASSISTANT IA ──────────────────────────────────────── */}
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

      {/* ── Environnement ────────────────────────────────────────────────────── */}
      <EnvironmentSection />

      {/* ── Corrélations ─────────────────────────────────────────────────────── */}
      <CorrelationSection />

      {/* ── Benchmark ────────────────────────────────────────────────────────── */}
      <BenchmarkSection />
    </div>
  );
}

// ── Corrélation note / taux d'occupation ─────────────────────────────────────

interface CorrelationPoint {
  vehiclePlate: string;
  vehicleLabel: string;
  month: string;
  rating: number;
  occupancyRate: number;
}
interface CorrelationData { points: CorrelationPoint[] }

function CorrelationSection(): React.JSX.Element {
  const { data, isLoading } = useQuery<CorrelationData>({
    queryKey: ['intelligence-correlation'],
    queryFn: () => api.get<CorrelationData>('/intelligence/correlation').then(r => r.data),
    staleTime: 30 * 60_000,
  });

  const points = data?.points ?? [];

  // Tendance linéaire (si ≥ 5 points)
  let trendLine: Array<{ rating: number; occupancyRate: number }> = [];
  if (points.length >= 5) {
    const n = points.length;
    const sumX = points.reduce((s, p) => s + p.rating, 0);
    const sumY = points.reduce((s, p) => s + p.occupancyRate, 0);
    const sumXY = points.reduce((s, p) => s + p.rating * p.occupancyRate, 0);
    const sumX2 = points.reduce((s, p) => s + p.rating * p.rating, 0);
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    const minR = Math.min(...points.map(p => p.rating));
    const maxR = Math.max(...points.map(p => p.rating));
    trendLine = [
      { rating: minR, occupancyRate: Math.round(slope * minR + intercept) },
      { rating: maxR, occupancyRate: Math.round(slope * maxR + intercept) },
    ];
  }

  return (
    <div data-testid="correlation-section" className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="border-b border-gray-100 px-5 py-3">
        <h2 className="text-sm font-semibold text-gray-900">Corrélations — Note vs Taux d&apos;occupation</h2>
        <p className="text-xs text-gray-400">Chaque point = un véhicule sur un mois. La droite de tendance apparaît à partir de 5 points.</p>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-10"><div className="h-6 w-6 animate-spin rounded-full border-4 border-t-transparent" style={{ borderColor: '#01696e', borderTopColor: 'transparent' }} /></div>
      ) : points.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">Aucune donnée disponible (ratings + locations requis)</p>
      ) : (
        <div className="p-5">
          <ResponsiveContainer width="100%" height={260}>
            <ScatterChart margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" dataKey="rating" name="Note" domain={[3, 5.5]} tick={{ fontSize: 11 }} label={{ value: 'Note Getaround', position: 'insideBottom', offset: -5, fontSize: 11 }} />
              <YAxis type="number" dataKey="occupancyRate" name="Occupation" unit="%" tick={{ fontSize: 11 }} domain={[0, 100]} label={{ value: 'Taux occupation', angle: -90, position: 'insideLeft', fontSize: 11 }} />
              <ZAxis range={[40, 40]} />
              <Tooltip cursor={{ strokeDasharray: '3 3' }}
                content={({ payload }) => {
                  if (!payload?.length) return null;
                  const p = payload[0]?.payload as CorrelationPoint;
                  return (
                    <div className="rounded-lg border border-gray-200 bg-white p-3 text-xs shadow">
                      <p className="font-semibold text-gray-800">{p.vehicleLabel}</p>
                      <p className="text-gray-500">{p.month}</p>
                      <p>Note : <span className="font-bold text-amber-600">{p.rating.toFixed(1)} ★</span></p>
                      <p>Occupation : <span className="font-bold text-[#01696e]">{p.occupancyRate}%</span></p>
                    </div>
                  );
                }}
              />
              <Scatter data={points} fill="#01696e" fillOpacity={0.7} />
              {trendLine.length === 2 && (
                <Scatter data={trendLine} fill="#ef4444" line={{ stroke: '#ef4444', strokeWidth: 2 }} shape={(() => null) as never} legendType="none" />
              )}
            </ScatterChart>
          </ResponsiveContainer>
          <p className="mt-1 text-center text-xs text-gray-400">{points.length} point{points.length > 1 ? 's' : ''} · 12 derniers mois</p>
        </div>
      )}
    </div>
  );
}

// ── Benchmark anonymisé ───────────────────────────────────────────────────────

interface BenchmarkData {
  hasData: boolean;
  message?: string;
  participantCount?: number;
  own?: { occupancyRate: number; caPerVehicle: number; healthScore: number } | null;
  median?: { occupancyRate: number; caPerVehicle: number; healthScore: number };
  avg?: { occupancyRate: number; caPerVehicle: number; healthScore: number };
  top80th?: { occupancyRate: number; caPerVehicle: number; healthScore: number };
}

function BenchmarkSection(): React.JSX.Element {
  const { user } = useAuth();
  const isPlanEnterprise = (user as unknown as { plan?: string })?.plan === 'enterprise';

  const { data, isLoading } = useQuery<BenchmarkData>({
    queryKey: ['intelligence-benchmark'],
    queryFn: () => api.get<BenchmarkData>('/intelligence/benchmark').then(r => r.data),
    staleTime: 60 * 60_000,
    enabled: isPlanEnterprise,
    retry: false,
  });

  if (!isPlanEnterprise) {
    return (
      <div data-testid="benchmark-section" className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-gray-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-900">Benchmark anonymisé</h2>
        </div>
        <div className="p-6 text-center">
          <p className="text-sm text-gray-500">Disponible sur le plan <span className="font-semibold text-purple-700">Enterprise</span></p>
          <p className="mt-1 text-xs text-gray-400">Comparez votre flotte aux autres gestionnaires Getaround (données anonymisées).</p>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="benchmark-section" className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="border-b border-gray-100 px-5 py-3">
        <h2 className="text-sm font-semibold text-gray-900">Benchmark anonymisé — Flotte Enterprise</h2>
        <p className="text-xs text-gray-400">Données agrégées des flottes participantes (benchmarkConsent activé dans Paramètres).</p>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-10"><div className="h-6 w-6 animate-spin rounded-full border-4 border-t-transparent" style={{ borderColor: '#01696e', borderTopColor: 'transparent' }} /></div>
      ) : !data?.hasData ? (
        <p className="py-8 text-center text-sm text-gray-400">{data?.message ?? 'Aucune donnée benchmark disponible'}</p>
      ) : (
        <div className="p-5">
          <p className="mb-3 text-xs text-gray-500">{data.participantCount} flotte{(data.participantCount ?? 0) > 1 ? 's' : ''} participante{(data.participantCount ?? 0) > 1 ? 's' : ''} — mois en cours</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-400">
                  <th className="pb-2 text-left font-medium">Indicateur</th>
                  <th className="pb-2 text-right font-medium text-[#01696e]">Votre flotte</th>
                  <th className="pb-2 text-right font-medium text-gray-600">Médiane</th>
                  <th className="pb-2 text-right font-medium text-gray-600">Moyenne</th>
                  <th className="pb-2 text-right font-medium text-purple-700">Top 80e</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                <tr>
                  <td className="py-2 text-gray-700">Taux d&apos;occupation</td>
                  <td className="py-2 text-right font-semibold text-[#01696e]">{data.own?.occupancyRate ?? '—'}%</td>
                  <td className="py-2 text-right text-gray-600">{data.median?.occupancyRate}%</td>
                  <td className="py-2 text-right text-gray-600">{data.avg?.occupancyRate}%</td>
                  <td className="py-2 text-right text-purple-700">{data.top80th?.occupancyRate}%</td>
                </tr>
                <tr>
                  <td className="py-2 text-gray-700">CA / véhicule</td>
                  <td className="py-2 text-right font-semibold text-[#01696e]">{data.own?.caPerVehicle != null ? fmtEuro(data.own.caPerVehicle) : '—'}</td>
                  <td className="py-2 text-right text-gray-600">{data.median?.caPerVehicle != null ? fmtEuro(data.median.caPerVehicle) : '—'}</td>
                  <td className="py-2 text-right text-gray-600">{data.avg?.caPerVehicle != null ? fmtEuro(data.avg.caPerVehicle) : '—'}</td>
                  <td className="py-2 text-right text-purple-700">{data.top80th?.caPerVehicle != null ? fmtEuro(data.top80th.caPerVehicle) : '—'}</td>
                </tr>
                <tr>
                  <td className="py-2 text-gray-700">Health score</td>
                  <td className="py-2 text-right font-semibold text-[#01696e]">{data.own?.healthScore ?? '—'}</td>
                  <td className="py-2 text-right text-gray-600">{data.median?.healthScore}</td>
                  <td className="py-2 text-right text-gray-600">{data.avg?.healthScore}</td>
                  <td className="py-2 text-right text-purple-700">{data.top80th?.healthScore}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

interface EnvData {
  monthStart: string;
  totalCo2Kg: number;
  equivalentArbres: number;
  byVehicle: Array<{ vehicleId: string; label: string; co2Kg: number }>;
  facteurs: { essence: number; hybride: number; electrique: number; co2PerArbre: number };
}

function EnvironmentSection(): React.JSX.Element {
  const { data, isLoading } = useQuery<EnvData>({
    queryKey: ['intelligence-environment'],
    queryFn: () => api.get<EnvData>('/intelligence/environment').then(r => r.data),
    staleTime: 10 * 60_000,
  });

  return (
    <div data-testid="environment-section" className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="border-b border-gray-100 px-5 py-3">
        <h2 className="text-sm font-semibold text-gray-900">Environnement — Bilan carbone</h2>
        <p className="text-xs text-gray-400">CO₂ émis ce mois via les km Getaround. Facteurs modifiables dans Paramètres → Véhicule.</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><div className="h-6 w-6 animate-spin rounded-full border-4 border-t-transparent" style={{ borderColor: '#01696e', borderTopColor: 'transparent' }} /></div>
      ) : !data || data.byVehicle.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">Aucune donnée km disponible ce mois</p>
      ) : (
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-green-50 p-3">
              <p className="text-xs text-gray-500">CO₂ total ce mois</p>
              <p className="text-xl font-bold text-green-700">{data.totalCo2Kg} kg</p>
            </div>
            <div className="rounded-xl bg-emerald-50 p-3">
              <p className="text-xs text-gray-500">Équivalent arbres / an</p>
              <p className="text-xl font-bold text-emerald-700">{data.equivalentArbres} 🌳</p>
            </div>
            <div className="rounded-xl bg-gray-50 p-3 sm:col-span-1 col-span-2">
              <p className="text-xs text-gray-500">Facteurs utilisés</p>
              <p className="text-xs text-gray-600">Essence : {data.facteurs.essence} g/km · Hybride : {data.facteurs.hybride} g/km · Électrique : {data.facteurs.electrique} g/km</p>
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-gray-600">CO₂ par véhicule (kg)</p>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={data.byVehicle} margin={{ top: 5, right: 10, left: 0, bottom: 30 }}>
                <XAxis dataKey="label" tick={{ fontSize: 9 }} angle={-30} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 10 }} unit=" kg" />
                <Tooltip formatter={(v: number) => [`${v} kg CO₂`, '']} />
                <Bar dataKey="co2Kg" fill="#01696e" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
