import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { api } from '../../utils/api';

interface RentabilityEntry {
  vehicleId: string;
  make: string;
  model: string;
  licensePlate: string;
  caNet: number;
  caGross: number;
  fixedCosts: number;
  variableCosts: number;
  maintenanceMensuel: number;
  getaroundFees: number;
  totalCosts: number;
  breakEven: number;
  margin: number;
  isProfit: boolean;
  status: 'rentable' | 'déficitaire';
  caAnnuel: number;
  costsAnnuels: number;
  margeAnnuelle: number;
}

interface VehicleCost {
  id: string;
  label: string;
  amount: number;
  type: string;
  amortizationMonths: number | null;
  startDate: string;
  endDate: string | null;
}

interface FlaggedRental {
  id: string;
  getaroundId: string | number;
  driverName: string;
  startAt: string;
  endAt: string | null;
  evaluationFlag: string;
  evaluationFlagAmount: number | null;
  evaluationFlagUnblockedAt: string | null;
  vehicle: { make: string; model: string; licensePlate: string };
}

interface VehicleObjective { id: string; vehicleId: string; month: string; targetCA: number; }

const FLAG_LABELS: Record<string, string> = {
  blocked_cleaning: 'Nettoyage', blocked_damage: 'Dommage', blocked_claim: 'Sinistre',
  blocked_late: 'Retard', blocked_infraction: 'Infraction', blocked_gas: 'Carburant',
};

function fmtEuro(v: number): string {
  return v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
}

function fmtDate(s: string | null): string {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('fr-FR');
}

function pmt(principal: number, annualRate: number, months: number): number {
  if (annualRate === 0) return principal / months;
  const r = annualRate / 100 / 12;
  return principal * (r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1);
}

function AddCostModal({ vehicleId, make, model, onClose }: {
  vehicleId: string; make: string; model: string; onClose: () => void;
}): React.JSX.Element {
  const qc = useQueryClient();
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<'fixed' | 'onetime'>('fixed');
  const [amortizationMonths, setAmortizationMonths] = useState('12');

  const addMut = useMutation({
    mutationFn: () => api.post(`/vehicles/${vehicleId}/costs`, {
      label, amount: parseFloat(amount), type,
      ...(type === 'onetime' ? { amortizationMonths: parseInt(amortizationMonths) } : {}),
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['vehicle-costs', vehicleId] });
      void qc.invalidateQueries({ queryKey: ['rentability'] });
      onClose();
    },
  });

  const parsedAmount = parseFloat(amount);
  const parsedMonths = parseInt(amortizationMonths);
  const monthlyEq = type === 'onetime' && !isNaN(parsedAmount) && !isNaN(parsedMonths) && parsedMonths > 0
    ? parsedAmount / parsedMonths : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Ajouter un coût</h3>
            <p className="text-xs text-gray-400">{make} {model}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-gray-400 hover:text-gray-700 text-lg leading-none">✕</button>
        </div>
        <form onSubmit={e => { e.preventDefault(); if (label && amount) addMut.mutate(); }} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Libellé *</label>
            <input required data-testid="input-cost-label" value={label} onChange={e => setLabel(e.target.value)}
              placeholder="Assurance, Crédit, Parking…"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Type *</label>
              <select value={type} onChange={e => setType(e.target.value as 'fixed' | 'onetime')}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]">
                <option value="fixed">Fixe mensuel</option>
                <option value="onetime">Ponctuel amorti</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                {type === 'fixed' ? 'Montant / mois (€) *' : 'Montant total (€) *'}
              </label>
              <input required type="number" min="0" step="0.01" value={amount}
                onChange={e => setAmount(e.target.value)} data-testid="input-cost-amount"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
            </div>
          </div>
          {type === 'onetime' && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Amortissement (mois) *</label>
              <input required type="number" min="1" max="120" value={amortizationMonths}
                onChange={e => setAmortizationMonths(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
              {monthlyEq !== null && <p className="mt-0.5 text-xs text-[#01696e]">≈ {fmtEuro(monthlyEq)} / mois</p>}
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={!label || !amount || addMut.isPending}
              className="flex-1 rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              style={{ backgroundColor: '#01696e' }}>
              {addMut.isPending ? 'Ajout…' : 'Ajouter'}
            </button>
            <button type="button" onClick={onClose}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Annuler</button>
          </div>
          {addMut.isError && <p className="text-xs text-red-600">Erreur lors de l'ajout</p>}
        </form>
      </div>
    </div>
  );
}

function CostPanel({ vehicleId, breakEven }: { vehicleId: string; breakEven: number }): React.JSX.Element {
  const qc = useQueryClient();
  const { data } = useQuery<{ costs: VehicleCost[] }>({
    queryKey: ['vehicle-costs', vehicleId],
    queryFn: () => api.get<{ costs: VehicleCost[] }>(`/vehicles/${vehicleId}/costs`).then(r => r.data),
  });
  const deleteMut = useMutation({
    mutationFn: (costId: string) => api.delete(`/vehicles/${vehicleId}/costs/${costId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['vehicle-costs', vehicleId] });
      void qc.invalidateQueries({ queryKey: ['rentability'] });
    },
  });
  const costs = data?.costs ?? [];

  return (
    <div className="border-t border-gray-100 bg-gray-50">
      <div className="px-5 py-2 border-b border-gray-100">
        <p className="text-[11px] text-gray-500">
          Break-even : <span className="font-semibold text-gray-700">{fmtEuro(breakEven)}/mois</span>
        </p>
      </div>
      <div className="px-5 py-3 space-y-1.5">
        {costs.length === 0 ? (
          <p className="text-xs text-gray-400 py-1">Aucun coût — cliquez sur "+ Coût" pour en ajouter</p>
        ) : costs.map(c => {
          const monthly = c.type === 'onetime' && c.amortizationMonths ? c.amount / c.amortizationMonths : c.amount;
          return (
            <div key={c.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-gray-100 text-xs text-gray-700">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${c.type === 'fixed' ? 'bg-blue-50 text-blue-600' : 'bg-orange-50 text-orange-600'}`}>
                  {c.type === 'fixed' ? 'Fixe' : 'Ponctuel'}
                </span>
                <span className="font-medium truncate">{c.label}</span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <p className="font-semibold text-red-600">− {fmtEuro(monthly)}/mois</p>
                <button type="button" onClick={() => deleteMut.mutate(c.id)} disabled={deleteMut.isPending}
                  className="text-gray-300 hover:text-red-500 transition">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type SortKey = 'licensePlate' | 'caNet' | 'totalCosts' | 'margin' | 'caAnnuel' | 'costsAnnuels' | 'margeAnnuelle' | 'cashflowMensuelNet' | 'mensualitePret';
type MainTab = 'ce_mois' | 'objectifs' | 'revente';

// ─── Revente optimale ─────────────────────────────────────────────────────────

interface RoiFleetEntry {
  vehicleId: string;
  make: string;
  model: string;
  licensePlate: string;
  hasData: boolean;
  analysis: {
    roiActuel: number;
    roiMax: number;
    moisOptimal: number;
    moisRestants: number;
    valeurMarchandeActuelle: number;
    dateOptimale: string;
    plusValueNette: number;
    capitalRestantDu: number;
    signal: 'vendre_maintenant' | 'bientot' | 'attendre' | 'optimal';
    triActuel: number | null;
    cocActuel: number | null;
    cashflowMensuelNet: number;
    mensualitePret: number;
    moisVersDeclin: number;
    moisVersStop: number;
    kmActuel: number;
    kmParMois: number;
  } | null;
}

const SIGNAL_SORT: Record<string, number> = { vendre_maintenant: 0, bientot: 1, optimal: 2, attendre: 3 };
const SIGNAL_BADGE: Record<string, string> = {
  vendre_maintenant: 'bg-red-100 text-red-700',
  bientot: 'bg-amber-100 text-amber-700',
  optimal: 'bg-green-100 text-green-700',
  attendre: 'bg-gray-100 text-gray-600',
};
const SIGNAL_ICON: Record<string, string> = { vendre_maintenant: '🔴', bientot: '🟡', optimal: '🟢', attendre: '⚪' };
const SIGNAL_LABEL: Record<string, string> = {
  vendre_maintenant: 'Revendre maintenant',
  bientot: 'Revendre bientôt',
  optimal: 'Fenêtre optimale',
  attendre: 'Continuer à exploiter',
};

function ReventeTab({ roiFleetData, roiFleetLoading }: { roiFleetData: { fleet: RoiFleetEntry[] } | undefined; roiFleetLoading: boolean }): React.JSX.Element {
  type RoiSortKey = 'licensePlate' | 'kmActuel' | 'valeurMarchande' | 'plusValueNette' | 'roiActuel' | 'signal' | 'moisVersDeclin';
  const [roiSortKey, setRoiSortKey] = React.useState<RoiSortKey>('signal');
  const [roiSortDir, setRoiSortDir] = React.useState<'asc' | 'desc'>('asc');

  function toggleRoiSort(k: RoiSortKey) {
    if (roiSortKey === k) setRoiSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setRoiSortKey(k); setRoiSortDir('desc'); }
  }

  function RoiSortTh({ k, label }: { k: RoiSortKey; label: string }): React.JSX.Element {
    const active = roiSortKey === k;
    return (
      <th onClick={() => toggleRoiSort(k)}
        className={`px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide cursor-pointer select-none hover:text-gray-800 transition-colors ${active ? 'text-[#01696e]' : 'text-gray-500'}`}>
        {label}{active ? (roiSortDir === 'desc' ? ' ↓' : ' ↑') : ' ↕'}
      </th>
    );
  }

  const rows = [...(roiFleetData?.fleet ?? [])].sort((a, b) => {
    if (!a.hasData && b.hasData) return 1;
    if (a.hasData && !b.hasData) return -1;
    if (!a.analysis && !b.analysis) return 0;
    if (!a.analysis) return 1;
    if (!b.analysis) return -1;
    let cmp = 0;
    const aa = a.analysis, ba = b.analysis;
    if (roiSortKey === 'licensePlate') cmp = a.licensePlate.localeCompare(b.licensePlate, 'fr');
    else if (roiSortKey === 'kmActuel') cmp = aa.kmActuel - ba.kmActuel;
    else if (roiSortKey === 'valeurMarchande') cmp = (aa.valeurMarchandeActuelle ?? 0) - (ba.valeurMarchandeActuelle ?? 0);
    else if (roiSortKey === 'plusValueNette') cmp = aa.plusValueNette - ba.plusValueNette;
    else if (roiSortKey === 'roiActuel') cmp = aa.roiActuel - ba.roiActuel;
    else if (roiSortKey === 'signal') cmp = (SIGNAL_SORT[aa.signal] ?? 9) - (SIGNAL_SORT[ba.signal] ?? 9);
    else if (roiSortKey === 'moisVersDeclin') cmp = (aa.moisVersDeclin ?? 0) - (ba.moisVersDeclin ?? 0);
    return roiSortDir === 'desc' ? -cmp : cmp;
  });

  if (roiFleetLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" style={{ borderColor: '#01696e', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  return (
    <div data-testid="revente-tab" className="space-y-4">
      <p className="text-sm text-gray-500">
        Classement de la flotte par signal de revente basé sur le kilométrage. Trier par urgence pour prioriser les décisions.
      </p>
      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-100 bg-gray-50">
            <tr>
              <RoiSortTh k="licensePlate" label="Véhicule" />
              <RoiSortTh k="kmActuel" label="Km actuels" />
              <RoiSortTh k="valeurMarchande" label="Valeur marchande" />
              <RoiSortTh k="plusValueNette" label="Plus-value" />
              <RoiSortTh k="roiActuel" label="ROI actuel" />
              <RoiSortTh k="signal" label="Signal" />
              <RoiSortTh k="moisVersDeclin" label="Revente avant" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(row => {
              const a = row.analysis;

              if (!row.hasData || !a) {
                return (
                  <tr key={row.vehicleId} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {row.make} {row.model}
                      <span className="ml-2 font-mono text-xs text-gray-400">{row.licensePlate}</span>
                    </td>
                    <td colSpan={6} className="px-4 py-3 text-xs text-gray-400 italic">
                      Données incomplètes —{' '}
                      <a href={`/vehicles/${row.vehicleId}`} className="text-[#01696e] hover:underline">
                        Compléter la fiche
                      </a>
                    </td>
                  </tr>
                );
              }

              const moisAvantDeclin = a.moisVersDeclin;
              const now = new Date();
              const reventeDate = new Date(now.getFullYear(), now.getMonth() + moisAvantDeclin, 1)
                .toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
              const kmAuDeclin = Math.round(a.kmActuel + a.kmParMois * moisAvantDeclin);

              return (
                <tr key={row.vehicleId} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    <a href={`/vehicles/${row.vehicleId}`} className="hover:text-[#01696e] hover:underline">
                      {row.make} {row.model}
                    </a>
                    <span className="ml-2 font-mono text-xs text-gray-400">{row.licensePlate}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {a.kmActuel > 0 ? `${a.kmActuel.toLocaleString('fr-FR')} km` : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {(a.valeurMarchandeActuelle ?? 0) > 0 ? `${(a.valeurMarchandeActuelle).toLocaleString('fr-FR')} €` : '—'}
                  </td>
                  <td className={`px-4 py-3 font-semibold ${a.plusValueNette >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                    {a.plusValueNette >= 0 ? '+' : ''}{a.plusValueNette.toLocaleString('fr-FR')} €
                  </td>
                  <td className={`px-4 py-3 font-semibold ${a.roiActuel >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                    {a.roiActuel.toFixed(1)}%
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${SIGNAL_BADGE[a.signal]}`}>
                      {SIGNAL_ICON[a.signal]} {SIGNAL_LABEL[a.signal]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {moisAvantDeclin === 0
                      ? <span className="font-semibold text-red-600">Déclin imminent</span>
                      : <span>
                          <span className="font-medium">{reventeDate}</span>
                          <br />
                          <span className="text-[10px] text-gray-400">{kmAuDeclin.toLocaleString('fr-FR')} km · {moisAvantDeclin} mois</span>
                        </span>
                    }
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="py-8 text-center text-sm text-gray-400">Aucune donnée — complétez les fiches véhicule avec le prix d'achat et la valeur marchande.</p>
        )}
      </div>
    </div>
  );
}

function SinistresTab(): React.JSX.Element {
  const { data, isLoading } = useQuery<{ rentals: FlaggedRental[] }>({
    queryKey: ['flagged-rentals'],
    queryFn: () => api.get<{ rentals: FlaggedRental[] }>('/rentals/flagged').then(r => r.data),
    staleTime: 2 * 60_000,
  });

  const rentals = data?.rentals ?? [];

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden" data-testid="sinistres-tab">
      <div className="border-b border-gray-100 px-5 py-3">
        <h2 className="text-sm font-semibold text-gray-900">Frais supplémentaires Getaround</h2>
        <p className="text-xs text-gray-400">Locations avec évaluation bloquée (non débloquée)</p>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-10"><div className="h-6 w-6 animate-spin rounded-full border-4 border-t-transparent" style={{ borderColor: '#01696e', borderTopColor: 'transparent' }} /></div>
      ) : rentals.length === 0 ? (
        <p className="py-10 text-center text-sm text-gray-400">Aucun frais supplémentaire actif</p>
      ) : (
        <div className="divide-y divide-gray-50">
          {rentals.map(r => (
            <div key={r.id} className="flex items-center gap-4 px-5 py-3 text-sm">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 truncate">{r.driverName}</p>
                <p className="text-xs text-gray-400">{r.vehicle.make} {r.vehicle.model} · {r.vehicle.licensePlate}</p>
              </div>
              <div className="text-right shrink-0">
                <span className="inline-flex rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">
                  {FLAG_LABELS[r.evaluationFlag] ?? r.evaluationFlag}
                </span>
                {r.evaluationFlagAmount && (
                  <p className="text-xs text-gray-500 mt-0.5">{(r.evaluationFlagAmount / 100).toFixed(2)} €</p>
                )}
              </div>
              <div className="text-right shrink-0 text-xs text-gray-400">
                <p>{fmtDate(r.startAt)}</p>
                <p className={r.evaluationFlagUnblockedAt ? 'text-green-600' : 'text-orange-500'}>
                  {r.evaluationFlagUnblockedAt ? 'Débloqué' : 'En attente'}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SimulateurTab(): React.JSX.Element {
  const [vehiclePrice, setVehiclePrice] = useState('');
  const [apport, setApport] = useState('');
  const [annualRate, setAnnualRate] = useState('');
  const [months, setMonths] = useState('60');
  const [monthlyRevenue, setMonthlyRevenue] = useState('');
  const [monthlyCharges, setMonthlyCharges] = useState('');

  const price = parseFloat(vehiclePrice) || 0;
  const apportVal = parseFloat(apport) || 0;
  const rate = parseFloat(annualRate) || 0;
  const nMonths = parseInt(months) || 60;
  const revenue = parseFloat(monthlyRevenue) || 0;
  const charges = parseFloat(monthlyCharges) || 0;
  const capital = Math.max(0, price - apportVal);
  const mensualite = capital > 0 ? pmt(capital, rate, nMonths) : 0;
  const margeNette = revenue - charges - mensualite;

  const chartData = Array.from({ length: Math.min(nMonths, 60) }, (_, i) => {
    const m = i + 1;
    const cumCharges = (charges + mensualite) * m;
    const cumRevenue = revenue * m;
    return { month: m, cumRevenue: Math.round(cumRevenue), cumCharges: Math.round(cumCharges), solde: Math.round(cumRevenue - cumCharges) };
  });

  const breakEvenMonth = chartData.findIndex(d => d.solde >= 0);

  const roi3ans = price > 0 ? ((margeNette * 36 - apportVal) / (apportVal || 1)) * 100 : 0;
  const roi5ans = price > 0 ? ((margeNette * 60 - apportVal) / (apportVal || 1)) * 100 : 0;

  return (
    <div className="space-y-5" data-testid="simulateur-tab">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Simulateur ROI véhicule</h2>
          <p className="text-xs text-gray-400">Calculez le retour sur investissement et le point mort de votre véhicule</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {([
            ['vehiclePrice', vehiclePrice, setVehiclePrice, 'Prix du véhicule (€)', '25000'],
            ['apport', apport, setApport, 'Apport (€)', '5000'],
            ['annualRate', annualRate, setAnnualRate, 'Taux annuel (%)', '4.5'],
            ['months', months, setMonths, 'Durée crédit (mois)', '60'],
            ['monthlyRevenue', monthlyRevenue, setMonthlyRevenue, 'CA net/mois estimé (€)', '800'],
            ['monthlyCharges', monthlyCharges, setMonthlyCharges, 'Charges mensuelles (€)', '300'],
          ] as const).map(([key, val, setter, label, placeholder]) => (
            <div key={key}>
              <label className="mb-1 block text-xs font-medium text-gray-600">{label}</label>
              <input type="number" min="0" step="any" value={val}
                onChange={e => (setter as React.Dispatch<React.SetStateAction<string>>)(e.target.value)}
                placeholder={placeholder}
                data-testid={`input-sim-${key}`}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
            </div>
          ))}
        </div>
      </div>

      {capital > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl bg-gray-50 p-3">
              <p className="text-xs text-gray-500">Mensualité crédit</p>
              <p className="text-lg font-bold text-gray-900">{fmtEuro(mensualite)}/mois</p>
            </div>
            <div className="rounded-xl bg-gray-50 p-3">
              <p className="text-xs text-gray-500">Charges totales</p>
              <p className="text-lg font-bold text-red-600">{fmtEuro(charges + mensualite)}/mois</p>
            </div>
            <div className={`rounded-xl p-3 ${margeNette >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
              <p className="text-xs text-gray-500">Marge nette</p>
              <p className={`text-lg font-bold ${margeNette >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                {margeNette >= 0 ? '+' : ''}{fmtEuro(margeNette)}/mois
              </p>
            </div>
            <div className="rounded-xl bg-blue-50 p-3">
              <p className="text-xs text-gray-500">Délai rentabilisation</p>
              <p className="text-lg font-bold text-blue-700" data-testid="sim-delai-rentabilisation">
                {breakEvenMonth >= 0 ? `M+${breakEvenMonth + 1}` : 'Non atteint'}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-purple-50 p-3">
              <p className="text-xs text-gray-500">ROI sur 3 ans</p>
              <p className={`text-lg font-bold ${roi3ans >= 0 ? 'text-purple-700' : 'text-red-600'}`}>
                {roi3ans >= 0 ? '+' : ''}{roi3ans.toFixed(1)} %
              </p>
            </div>
            <div className="rounded-xl bg-purple-50 p-3">
              <p className="text-xs text-gray-500">ROI sur 5 ans</p>
              <p className={`text-lg font-bold ${roi5ans >= 0 ? 'text-purple-700' : 'text-red-600'}`}>
                {roi5ans >= 0 ? '+' : ''}{roi5ans.toFixed(1)} %
              </p>
            </div>
          </div>

          {chartData.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium text-gray-600">Évolution cumulée sur {Math.min(nMonths, 60)} mois</p>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} tickFormatter={v => `M${v}`} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${Math.round(v / 1000)}k`} />
                  <Tooltip formatter={(v: number) => fmtEuro(v)} labelFormatter={l => `Mois ${l}`} />
                  <ReferenceLine y={0} stroke="#ef4444" strokeDasharray="3 3" />
                  <Line type="monotone" dataKey="cumRevenue" stroke="#01696e" strokeWidth={2} dot={false} name="Revenus cumulés" />
                  <Line type="monotone" dataKey="cumCharges" stroke="#ef4444" strokeWidth={2} dot={false} name="Charges cumulées" />
                  <Line type="monotone" dataKey="solde" stroke="#3b82f6" strokeWidth={1.5} dot={false} name="Solde" strokeDasharray="4 2" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ObjectifsTab({ entries }: { entries: RentabilityEntry[] }): React.JSX.Element {
  const qc = useQueryClient();
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);

  const { data: settingsData } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<{ settings: { objectifSeuilAlerte: number } }>('/settings').then(r => r.data.settings),
    staleTime: 5 * 60_000,
  });
  const threshold = settingsData?.objectifSeuilAlerte ?? 80;

  const objectifMut = useMutation({
    mutationFn: ({ vehicleId, targetCA }: { vehicleId: string; targetCA: number }) =>
      api.patch(`/vehicles/${vehicleId}/objective`, { month, targetCA }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['vehicle-objectives'] }),
  });

  const [targets, setTargets] = useState<Record<string, string>>({});

  return (
    <div className="space-y-4" data-testid="objectifs-tab">
      <div className="flex items-center gap-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Mois</label>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
        </div>
        <p className="text-xs text-gray-400 mt-4">Seuil alerte : <span className="font-semibold text-gray-700">{threshold}%</span> — configurable dans Paramètres → Comptabilité</p>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-gray-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-900">Objectifs CA par véhicule</h2>
        </div>
        {entries.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-400">Aucune donnée de rentabilité</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {entries.map(e => {
              const inputVal = targets[e.vehicleId] ?? '';
              const target = parseFloat(inputVal) || null;
              const pct = target && e.caNet > 0 ? Math.round((e.caNet / target) * 100) : null;
              const color = pct === null ? 'bg-gray-200' : pct >= 100 ? 'bg-green-500' : pct >= threshold ? 'bg-yellow-400' : 'bg-orange-500';

              return (
                <div key={e.vehicleId} className="px-5 py-3">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="font-mono text-xs bg-gray-100 rounded px-1.5 py-0.5 text-gray-700">{e.licensePlate}</span>
                    <span className="text-sm text-gray-700">{e.make} {e.model}</span>
                    <span className="text-sm font-semibold text-green-700 ml-auto">{fmtEuro(e.caNet)}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <input type="number" min="0" step="10" value={inputVal}
                      onChange={ev => setTargets(t => ({ ...t, [e.vehicleId]: ev.target.value }))}
                      placeholder="Objectif CA (€)"
                      data-testid={`input-objectif-${e.vehicleId}`}
                      className="w-36 rounded-lg border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-[#01696e]" />
                    <button type="button" disabled={!inputVal || objectifMut.isPending}
                      onClick={() => { if (target) objectifMut.mutate({ vehicleId: e.vehicleId, targetCA: target }); }}
                      className="rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                      style={{ backgroundColor: '#01696e' }}>
                      Sauver
                    </button>
                    {pct !== null && (
                      <div className="flex-1 flex items-center gap-2">
                        <div className="flex-1 rounded-full bg-gray-100 h-2">
                          <div className={`${color} h-2 rounded-full transition-all`} style={{ width: `${Math.min(pct, 100)}%` }} />
                        </div>
                        <span className={`text-xs font-semibold ${pct >= 100 ? 'text-green-700' : pct >= threshold ? 'text-yellow-600' : 'text-orange-600'}`}>
                          {pct}%
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function RentabilityPage(): React.JSX.Element {
  const [tab, setTab] = useState<MainTab>('ce_mois');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('caNet');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [addModal, setAddModal] = useState<{ vehicleId: string; make: string; model: string } | null>(null);
  const [outilsOpen, setOutilsOpen] = useState(false);

  const PRIMARY = '#01696e';

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('desc'); }
  }

  const { data, isLoading } = useQuery<{ rentability: RentabilityEntry[] }>({
    queryKey: ['rentability'],
    queryFn: () => api.get<{ rentability: RentabilityEntry[] }>('/intelligence/rentability').then(r => r.data),
    staleTime: 5 * 60_000,
  });

  const { data: roiFleetData, isLoading: roiFleetLoading } = useQuery<{ fleet: RoiFleetEntry[] }>({
    queryKey: ['roi-fleet'],
    queryFn: () => api.get<{ fleet: RoiFleetEntry[] }>('/vehicles/roi-fleet').then(r => r.data),
    staleTime: 10 * 60_000,
  });
  const roiMap = new Map((roiFleetData?.fleet ?? []).map(r => [r.vehicleId, r.analysis]));

  type RentabilityEntryPlus = RentabilityEntry & { cashflowMensuelNet: number | null; mensualitePret: number | null; signal: string | null; moisVersDeclin: number | null };

  const rawEntries: RentabilityEntryPlus[] = (data?.rentability ?? []).map(e => {
    const roi = roiMap.get(e.vehicleId);
    return { ...e, cashflowMensuelNet: roi?.cashflowMensuelNet ?? null, mensualitePret: roi?.mensualitePret ?? null, signal: roi?.signal ?? null, moisVersDeclin: roi?.moisVersDeclin ?? null };
  });
  const entries = [...rawEntries].sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'licensePlate') cmp = a.licensePlate.localeCompare(b.licensePlate, 'fr');
    else if (sortKey === 'cashflowMensuelNet') cmp = (a.cashflowMensuelNet ?? 0) - (b.cashflowMensuelNet ?? 0);
    else if (sortKey === 'mensualitePret') cmp = (a.mensualitePret ?? 0) - (b.mensualitePret ?? 0);
    else cmp = (a[sortKey as keyof RentabilityEntry] as number) - (b[sortKey as keyof RentabilityEntry] as number);
    return sortDir === 'desc' ? -cmp : cmp;
  });
  const totalCA = rawEntries.reduce((s, e) => s + e.caNet, 0);
  const totalCosts = rawEntries.reduce((s, e) => s + e.totalCosts, 0);
  const totalMargin = totalCA - totalCosts;

  const TABS: { key: MainTab; label: string }[] = [
    { key: 'ce_mois', label: 'Ce mois' },
    { key: 'revente', label: 'Revente' },
    { key: 'objectifs', label: 'Objectifs CA' },
  ];

  return (
    <div className="p-4 lg:p-6 max-w-5xl space-y-5">
      {addModal && (
        <AddCostModal vehicleId={addModal.vehicleId} make={addModal.make} model={addModal.model} onClose={() => setAddModal(null)} />
      )}

      <div>
        <h1 className="text-xl font-bold text-gray-900">Rentabilité</h1>
        <p className="text-sm text-gray-500">Analyse financière de la flotte</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-gray-100 p-1 w-fit" data-testid="rentability-tabs">
        {TABS.map(t => (
          <button key={t.key} type="button"
            onClick={() => setTab(t.key)}
            data-testid={`tab-${t.key}`}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'ce_mois' && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium text-gray-500">CA net flotte</p>
              <p className="mt-1 text-xl font-bold text-green-700">{fmtEuro(totalCA)}</p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium text-gray-500">Coûts enregistrés</p>
              <p className="mt-1 text-xl font-bold text-red-600">{fmtEuro(totalCosts)}</p>
            </div>
            <div className={`rounded-2xl border p-4 shadow-sm ${totalMargin >= 0 ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}`}>
              <p className="text-xs font-medium text-gray-500">Marge nette</p>
              <p className={`mt-1 text-xl font-bold ${totalMargin >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                {totalMargin >= 0 ? '+' : ''}{fmtEuro(totalMargin)}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div className="border-b border-gray-100 px-5 py-3">
              <h2 className="text-sm font-semibold text-gray-900">Détail par véhicule</h2>
              <p className="text-xs text-gray-400">Cliquez sur une ligne pour voir les coûts</p>
            </div>

            {!isLoading && entries.length > 0 && (
              <div className="flex items-center gap-4 px-5 py-2 border-b border-gray-100 text-[10px] font-semibold uppercase tracking-wide bg-gray-50">
                {(['licensePlate', 'caNet', 'totalCosts', 'margin', 'caAnnuel', 'costsAnnuels', 'margeAnnuelle', 'cashflowMensuelNet', 'mensualitePret'] as SortKey[]).map((k, i) => {
                  const labels: Record<SortKey, string> = {
                    licensePlate: 'Véhicule', caNet: 'CA net / mois', totalCosts: 'Coûts / mois',
                    margin: 'Marge mens.', caAnnuel: 'CA annuel', costsAnnuels: 'Coûts ann.', margeAnnuelle: 'Marge ann.',
                    cashflowMensuelNet: 'Cashflow net', mensualitePret: 'Mensualité',
                  };
                  const active = sortKey === k;
                  const isGreen = i >= 4 && i <= 6;
                  return (
                    <button key={k} type="button" onClick={() => toggleSort(k)}
                      className={`cursor-pointer select-none hover:opacity-80 transition flex items-center gap-0.5 ${i === 0 ? 'flex-1 text-left justify-start' : 'text-right min-w-24 justify-end'} ${isGreen ? 'rounded px-1.5 py-0.5' : ''}`}
                      style={{ color: active ? PRIMARY : '#9ca3af', background: isGreen ? '#f0fdf4' : 'transparent' }}>
                      {labels[k]}{active ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
                    </button>
                  );
                })}
                <div className="text-right text-gray-400 min-w-16 shrink-0">Signal km</div>
                <div className="w-20 shrink-0" />
              </div>
            )}

            {isLoading ? (
              <div className="flex justify-center py-16">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-t-transparent"
                  style={{ borderColor: PRIMARY, borderTopColor: 'transparent' }} />
              </div>
            ) : entries.length === 0 ? (
              <p className="py-16 text-center text-sm text-gray-400">Aucune donnée de rentabilité pour ce mois</p>
            ) : (
              entries.map(e => (
                <div key={e.vehicleId} className="border-b border-gray-50 last:border-0">
                  <div className="flex items-center gap-4 px-5 py-3 text-sm hover:bg-gray-50/50 transition-colors">
                    <button type="button"
                      onClick={() => setExpanded(exp => exp === e.vehicleId ? null : e.vehicleId)}
                      className="flex-1 min-w-0 text-left flex items-center gap-4">
                      <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-semibold text-gray-700 bg-gray-100 rounded px-1.5 py-0.5">{e.licensePlate}</span>
                        <span className="text-gray-600">{e.make} {e.model}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${e.status === 'rentable' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>{e.status}</span>
                      </div>
                      <div className="text-right min-w-24 shrink-0">
                        <p className="text-[10px] text-gray-400">CA net</p>
                        <p className="font-semibold text-green-700">{fmtEuro(e.caNet)}</p>
                      </div>
                      <div className="text-right min-w-24 shrink-0">
                        <p className="text-[10px] text-gray-400">Coûts</p>
                        <p className="font-semibold text-red-600">{fmtEuro(e.totalCosts)}</p>
                      </div>
                      <div className="text-right min-w-28 shrink-0">
                        <p className="text-[10px] text-gray-400">Marge</p>
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${e.isProfit ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                          {e.isProfit ? '+' : ''}{fmtEuro(e.margin)}
                        </span>
                      </div>
                      <div className="text-right min-w-24 shrink-0 rounded px-1.5" style={{ background: '#f0fdf4' }}>
                        <p className="text-[10px] text-gray-400">CA annuel</p>
                        <p className="font-semibold text-green-700">{fmtEuro(e.caAnnuel)}</p>
                      </div>
                      <div className="text-right min-w-24 shrink-0 rounded px-1.5" style={{ background: '#f0fdf4' }}>
                        <p className="text-[10px] text-gray-400">Coûts ann.</p>
                        <p className="font-semibold text-red-600">{fmtEuro(e.costsAnnuels)}</p>
                      </div>
                      <div className="text-right min-w-28 shrink-0 rounded px-1.5" style={{ background: '#f0fdf4' }}>
                        <p className="text-[10px] text-gray-400">Marge ann.</p>
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${e.margeAnnuelle >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                          {e.margeAnnuelle >= 0 ? '+' : ''}{fmtEuro(e.margeAnnuelle)}
                        </span>
                      </div>
                      {e.cashflowMensuelNet !== null && (
                        <div className="text-right min-w-20 shrink-0">
                          <p className="text-[10px] text-gray-400">Cashflow</p>
                          <p className={`text-xs font-semibold ${e.cashflowMensuelNet >= 0 ? 'text-green-700' : 'text-red-600'}`}>{e.cashflowMensuelNet >= 0 ? '+' : ''}{fmtEuro(e.cashflowMensuelNet)}</p>
                        </div>
                      )}
                      {e.mensualitePret !== null && e.mensualitePret > 0 && (
                        <div className="text-right min-w-20 shrink-0">
                          <p className="text-[10px] text-gray-400">Mensualité</p>
                          <p className="text-xs font-semibold text-gray-700">{fmtEuro(e.mensualitePret)}</p>
                        </div>
                      )}
                      {e.signal && (
                        <div className="min-w-16 shrink-0 flex justify-end">
                          <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${SIGNAL_BADGE[e.signal] ?? 'bg-gray-100 text-gray-500'}`}>
                            {SIGNAL_ICON[e.signal]}
                            {e.moisVersDeclin !== null && e.moisVersDeclin <= 12
                              ? `${e.moisVersDeclin}m`
                              : SIGNAL_LABEL[e.signal]?.split(' ')[0]}
                          </span>
                        </div>
                      )}
                      <svg className={`h-4 w-4 text-gray-400 transition-transform duration-200 shrink-0 ${expanded === e.vehicleId ? 'rotate-180' : ''}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    <button type="button"
                      onClick={() => setAddModal({ vehicleId: e.vehicleId, make: e.make, model: e.model })}
                      className="shrink-0 flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:border-[#01696e] hover:text-[#01696e] transition">
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                      </svg>
                      Coût
                    </button>
                  </div>
                  {expanded === e.vehicleId && (
                    <>
                      {(e.maintenanceMensuel > 0 || e.getaroundFees > 0) && (
                        <div className="flex gap-4 border-t border-gray-50 bg-gray-50/60 px-4 py-2 text-xs text-gray-500">
                          <span>Charges fixes : <strong className="text-gray-700">{fmtEuro(e.fixedCosts + e.variableCosts)}</strong></span>
                          {e.maintenanceMensuel > 0 && <span>Entretiens moy. / mois : <strong className="text-orange-600">{fmtEuro(e.maintenanceMensuel)}</strong></span>}
                          {e.getaroundFees > 0 && <span>Commission Getaround : <strong className="text-gray-600">{fmtEuro(e.getaroundFees)}</strong> (info)</span>}
                        </div>
                      )}
                      <CostPanel vehicleId={e.vehicleId} breakEven={e.breakEven ?? e.totalCosts} />
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </>
      )}

      {tab === 'objectifs' && <ObjectifsTab entries={rawEntries} />}
      {tab === 'revente' && <ReventeTab roiFleetData={roiFleetData} roiFleetLoading={roiFleetLoading} />}

      {/* Outils avancés (Sinistres + Simulateur) */}
      <div className="rounded-2xl border border-gray-100 bg-gray-50/50">
        <button type="button"
          onClick={() => setOutilsOpen(o => !o)}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-gray-600 hover:text-gray-900 transition">
          <span className="flex items-center gap-2">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Outils avancés
          </span>
          <svg className={`h-4 w-4 transition-transform ${outilsOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {outilsOpen && (
          <div className="border-t border-gray-100 p-4 space-y-6">
            <SinistresTab />
            <SimulateurTab />
          </div>
        )}
      </div>
    </div>
  );
}
