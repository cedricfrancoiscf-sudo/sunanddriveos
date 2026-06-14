import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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

function fmtEuro(v: number): string {
  return v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
}

function AddCostModal({ vehicleId, make, model, onClose }: {
  vehicleId: string;
  make: string;
  model: string;
  onClose: () => void;
}): React.JSX.Element {
  const qc = useQueryClient();
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<'fixed' | 'onetime'>('fixed');
  const [amortizationMonths, setAmortizationMonths] = useState('12');

  const addMut = useMutation({
    mutationFn: () => api.post(`/vehicles/${vehicleId}/costs`, {
      label,
      amount: parseFloat(amount),
      type,
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
    ? parsedAmount / parsedMonths
    : null;

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
            <input required name="label" value={label} onChange={e => setLabel(e.target.value)}
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
              <input required type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
                placeholder="0"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
            </div>
          </div>
          {type === 'onetime' && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Amortissement (mois) *</label>
              <input required type="number" min="1" max="120" value={amortizationMonths}
                onChange={e => setAmortizationMonths(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
              {monthlyEq !== null && (
                <p className="mt-0.5 text-xs text-[#01696e]">≈ {fmtEuro(monthlyEq)} / mois</p>
              )}
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={!label || !amount || addMut.isPending}
              className="flex-1 rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              style={{ backgroundColor: '#01696e' }}>
              {addMut.isPending ? 'Ajout…' : 'Ajouter'}
            </button>
            <button type="button" onClick={onClose}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
              Annuler
            </button>
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
          Break-even : <span className="font-semibold text-gray-700">{fmtEuro(breakEven)}/mois</span> de CA net minimum pour couvrir les charges
        </p>
      </div>
      <div className="px-5 py-3 space-y-1.5">
        {costs.length === 0 ? (
          <p className="text-xs text-gray-400 py-1">Aucun coût enregistré — cliquez sur "+ Coût" pour en ajouter</p>
        ) : (
          costs.map(c => {
            const isOnetime = c.type === 'onetime';
            const monthly = isOnetime && c.amortizationMonths ? c.amount / c.amortizationMonths : c.amount;
            return (
              <div key={c.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-gray-100 text-xs text-gray-700">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${c.type === 'fixed' ? 'bg-blue-50 text-blue-600' : 'bg-orange-50 text-orange-600'}`}>
                    {c.type === 'fixed' ? 'Fixe' : 'Ponctuel'}
                  </span>
                  <span className="font-medium truncate">{c.label}</span>
                  {isOnetime && c.amortizationMonths && (
                    <span className="text-gray-400 shrink-0">sur {c.amortizationMonths} mois</span>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <p className="font-semibold text-red-600">− {fmtEuro(monthly)}/mois</p>
                    {isOnetime && c.amortizationMonths && (
                      <p className="text-[10px] text-gray-400">total {fmtEuro(c.amount)}</p>
                    )}
                  </div>
                  <button type="button" onClick={() => deleteMut.mutate(c.id)} disabled={deleteMut.isPending}
                    className="text-gray-300 hover:text-red-500 transition">
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

type SortKey = 'licensePlate' | 'caNet' | 'totalCosts' | 'margin' | 'caAnnuel' | 'costsAnnuels' | 'margeAnnuelle';

export default function RentabilityPage(): React.JSX.Element {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('caNet');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [addModal, setAddModal] = useState<{ vehicleId: string; make: string; model: string } | null>(null);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('desc'); }
  }

  const PRIMARY = '#01696e';

  const { data, isLoading } = useQuery<{ rentability: RentabilityEntry[] }>({
    queryKey: ['rentability'],
    queryFn: () => api.get<{ rentability: RentabilityEntry[] }>('/intelligence/rentability').then(r => r.data),
    staleTime: 5 * 60_000,
  });

  const rawEntries = data?.rentability ?? [];
  const entries = [...rawEntries].sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'licensePlate') cmp = a.licensePlate.localeCompare(b.licensePlate, 'fr');
    else cmp = (a[sortKey] as number) - (b[sortKey] as number);
    return sortDir === 'desc' ? -cmp : cmp;
  });
  const totalCA = rawEntries.reduce((s, e) => s + e.caNet, 0);
  const totalCosts = rawEntries.reduce((s, e) => s + e.totalCosts, 0);
  const totalMargin = totalCA - totalCosts;

  return (
    <div className="p-4 lg:p-6 max-w-5xl space-y-5">
      {addModal && (
        <AddCostModal
          vehicleId={addModal.vehicleId}
          make={addModal.make}
          model={addModal.model}
          onClose={() => setAddModal(null)}
        />
      )}

      <div>
        <h1 className="text-xl font-bold text-gray-900">Rentabilité</h1>
        <p className="text-sm text-gray-500">Analyse coûts vs revenus — mois en cours</p>
      </div>

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
          <p className="text-xs text-gray-400">Cliquez sur une ligne pour voir les coûts · bouton + pour en ajouter</p>
        </div>

        {!isLoading && entries.length > 0 && (
          <div className="flex items-center gap-4 px-5 py-2 border-b border-gray-100 text-[10px] font-semibold uppercase tracking-wide bg-gray-50">
            {(['licensePlate', 'caNet', 'totalCosts', 'margin', 'caAnnuel', 'costsAnnuels', 'margeAnnuelle'] as SortKey[]).map((k, i) => {
              const labels: Record<SortKey, string> = {
                licensePlate: 'Véhicule', caNet: 'CA net / mois', totalCosts: 'Coûts / mois',
                margin: 'Marge mens.', caAnnuel: 'CA annuel', costsAnnuels: 'Coûts ann.', margeAnnuelle: 'Marge ann.',
              };
              const active = sortKey === k;
              const isGreen = i >= 4;
              return (
                <button key={k} type="button" onClick={() => toggleSort(k)}
                  className={`cursor-pointer select-none hover:opacity-80 transition flex items-center gap-0.5 ${i === 0 ? 'flex-1 text-left justify-start' : 'text-right min-w-24 justify-end'} ${isGreen ? 'rounded px-1.5 py-0.5' : ''}`}
                  style={{ color: active ? PRIMARY : '#9ca3af', background: isGreen ? '#f0fdf4' : 'transparent' }}>
                  {labels[k]}{active ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
                </button>
              );
            })}
            <div className="w-20 shrink-0" />
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-t-transparent"
              style={{ borderColor: '#01696e', borderTopColor: 'transparent' }} />
          </div>
        ) : entries.length === 0 ? (
          <p className="py-16 text-center text-sm text-gray-400">Aucune donnée de rentabilité pour ce mois</p>
        ) : (
          entries.map(e => (
            <div key={e.vehicleId} className="border-b border-gray-50 last:border-0">
              <div className="flex items-center gap-4 px-5 py-3 text-sm hover:bg-gray-50/50 transition-colors">
                <button
                  type="button"
                  onClick={() => setExpanded(exp => exp === e.vehicleId ? null : e.vehicleId)}
                  className="flex-1 min-w-0 text-left flex items-center gap-4">
                  <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-semibold text-gray-700 bg-gray-100 rounded px-1.5 py-0.5">{e.licensePlate}</span>
                    <span className="text-gray-600">{e.make} {e.model}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${e.status === 'rentable' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                      {e.status}
                    </span>
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
                  <svg
                    className={`h-4 w-4 text-gray-400 transition-transform duration-200 shrink-0 ${expanded === e.vehicleId ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => setAddModal({ vehicleId: e.vehicleId, make: e.make, model: e.model })}
                  className="shrink-0 flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:border-[#01696e] hover:text-[#01696e] transition"
                  title="Ajouter un coût">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  Coût
                </button>
              </div>
              {expanded === e.vehicleId && <CostPanel vehicleId={e.vehicleId} breakEven={e.breakEven ?? e.totalCosts} />}
            </div>
          ))
        )}
      </div>

      <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4 text-center">
        <p className="text-sm text-gray-400">Valorisation véhicule via API Autobiz — à venir</p>
      </div>
    </div>
  );
}
