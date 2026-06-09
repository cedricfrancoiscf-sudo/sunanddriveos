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
  margin: number;
  isProfit: boolean;
  caAnnuel: number;
  costsAnnuels: number;
  margeAnnuelle: number;
}

interface VehicleCost {
  id: string;
  label: string;
  amount: number;
  type: string;
}

function fmtEuro(v: number): string {
  return v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
}

function CostPanel({ vehicleId }: { vehicleId: string }): React.JSX.Element {
  const qc = useQueryClient();
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<'fixed' | 'variable'>('fixed');

  const { data } = useQuery<{ costs: VehicleCost[] }>({
    queryKey: ['vehicle-costs', vehicleId],
    queryFn: () => api.get<{ costs: VehicleCost[] }>(`/vehicles/${vehicleId}/costs`).then(r => r.data),
  });

  const addMut = useMutation({
    mutationFn: () => api.post(`/vehicles/${vehicleId}/costs`, { label, amount: parseFloat(amount), type }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['vehicle-costs', vehicleId] });
      void qc.invalidateQueries({ queryKey: ['rentability'] });
      setLabel(''); setAmount('');
    },
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
    <div className="border-t border-gray-100 bg-gray-50 px-5 py-4 space-y-3">
      {costs.length === 0 && (
        <p className="text-xs text-gray-400">Aucun coût enregistré — ajoutez des charges fixes ou variables</p>
      )}
      <div className="grid grid-cols-1 gap-1.5">
        {costs.map(c => (
          <div key={c.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-gray-100 text-xs text-gray-700">
            <span className="font-medium">{c.label}</span>
            <div className="flex items-center gap-3">
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${c.type === 'fixed' ? 'bg-blue-50 text-blue-600' : 'bg-orange-50 text-orange-600'}`}>
                {c.type === 'fixed' ? 'Fixe' : 'Variable'}
              </span>
              <span className="font-semibold text-red-600">− {fmtEuro(c.amount)}</span>
              <button type="button" onClick={() => deleteMut.mutate(c.id)} disabled={deleteMut.isPending}
                className="text-gray-300 hover:text-red-500 transition">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        ))}
      </div>
      <form onSubmit={e => { e.preventDefault(); if (label && amount) addMut.mutate(); }}
        className="flex flex-wrap gap-2 items-center">
        <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Ex: Assurance, Crédit, Parking…"
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs outline-none focus:border-[#01696e] flex-1 min-w-36" />
        <input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Montant €"
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs outline-none focus:border-[#01696e] w-28" />
        <select value={type} onChange={e => setType(e.target.value as 'fixed' | 'variable')}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs outline-none focus:border-[#01696e]">
          <option value="fixed">Fixe</option>
          <option value="variable">Variable</option>
        </select>
        <button type="submit" disabled={!label || !amount || addMut.isPending}
          className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40 transition"
          style={{ backgroundColor: '#01696e' }}>
          {addMut.isPending ? '…' : 'Ajouter'}
        </button>
      </form>
    </div>
  );
}

export default function RentabilityPage(): React.JSX.Element {
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{ rentability: RentabilityEntry[] }>({
    queryKey: ['rentability'],
    queryFn: () => api.get<{ rentability: RentabilityEntry[] }>('/intelligence/rentability').then(r => r.data),
    staleTime: 5 * 60_000,
  });

  const entries = data?.rentability ?? [];
  const totalCA = entries.reduce((s, e) => s + e.caNet, 0);
  const totalCosts = entries.reduce((s, e) => s + e.totalCosts, 0);
  const totalMargin = totalCA - totalCosts;

  return (
    <div className="p-4 lg:p-6 max-w-5xl space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Rentabilité</h1>
        <p className="text-sm text-gray-500">Analyse coûts vs revenus — mois en cours</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-gray-500">CA net</p>
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
          <p className="text-xs text-gray-400">Cliquez sur un véhicule pour gérer ses coûts</p>
        </div>
        {!isLoading && entries.length > 0 && (
          <div className="flex items-center gap-4 px-5 py-2 border-b border-gray-100 text-[10px] font-semibold text-gray-400 uppercase tracking-wide bg-gray-50">
            <div className="flex-1 text-left">Véhicule</div>
            <div className="text-right min-w-24">CA net / mois</div>
            <div className="text-right min-w-24">Coûts / mois</div>
            <div className="text-right min-w-28">Marge mens.</div>
            <div className="text-right min-w-24 rounded px-1.5 py-0.5" style={{ background: '#f0fdf4' }}>CA annuel</div>
            <div className="text-right min-w-24 rounded px-1.5 py-0.5" style={{ background: '#f0fdf4' }}>Coûts ann.</div>
            <div className="text-right min-w-28 rounded px-1.5 py-0.5" style={{ background: '#f0fdf4' }}>Marge ann.</div>
            <div className="w-4" />
          </div>
        )}
        {isLoading ? (
          <div className="flex justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-t-transparent"
              style={{ borderColor: '#01696e', borderTopColor: 'transparent' }} />
          </div>
        ) : entries.length === 0 ? (
          <p className="py-16 text-center text-sm text-gray-400">Aucune donnée</p>
        ) : (
          entries.map(e => (
            <div key={e.vehicleId} className="border-b border-gray-50 last:border-0">
              <button
                type="button"
                onClick={() => setExpanded(exp => exp === e.vehicleId ? null : e.vehicleId)}
                className="w-full hover:bg-gray-50/50 transition-colors">
                <div className="flex items-center gap-4 px-5 py-3 text-sm">
                  <div className="flex-1 text-left">
                    <span className="font-mono text-xs font-semibold text-gray-700 bg-gray-100 rounded px-1.5 py-0.5 mr-2">{e.licensePlate}</span>
                    <span className="text-gray-600">{e.make} {e.model}</span>
                  </div>
                  <div className="text-right min-w-24">
                    <p className="text-[10px] text-gray-400">CA net</p>
                    <p className="font-semibold text-green-700">{fmtEuro(e.caNet)}</p>
                  </div>
                  <div className="text-right min-w-24">
                    <p className="text-[10px] text-gray-400">Coûts</p>
                    <p className="font-semibold text-red-600">{fmtEuro(e.totalCosts)}</p>
                  </div>
                  <div className="text-right min-w-28">
                    <p className="text-[10px] text-gray-400">Marge</p>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${e.isProfit ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                      {e.isProfit ? '+' : ''}{fmtEuro(e.margin)}
                    </span>
                  </div>
                  <div className="text-right min-w-24 rounded px-1.5" style={{ background: '#f0fdf4' }}>
                    <p className="text-[10px] text-gray-400">CA annuel</p>
                    <p className="font-semibold text-green-700">{fmtEuro(e.caAnnuel)}</p>
                  </div>
                  <div className="text-right min-w-24 rounded px-1.5" style={{ background: '#f0fdf4' }}>
                    <p className="text-[10px] text-gray-400">Coûts ann.</p>
                    <p className="font-semibold text-red-600">{fmtEuro(e.costsAnnuels)}</p>
                  </div>
                  <div className="text-right min-w-28 rounded px-1.5" style={{ background: '#f0fdf4' }}>
                    <p className="text-[10px] text-gray-400">Marge ann.</p>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${e.margeAnnuelle >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                      {e.margeAnnuelle >= 0 ? '+' : ''}{fmtEuro(e.margeAnnuelle)}
                    </span>
                  </div>
                  <svg
                    className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${expanded === e.vehicleId ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>
              {expanded === e.vehicleId && <CostPanel vehicleId={e.vehicleId} />}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
