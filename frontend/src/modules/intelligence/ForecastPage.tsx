import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { api } from '../../utils/api';

interface ForecastWeek {
  label: string;
  rentalCount: number;
  encaisse: number;
  previsionnel: number;
  totalPayout: number;
}

const fmtEuro = (n: number) =>
  n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

export default function ForecastPage(): React.JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: ['intelligence-forecasts'],
    queryFn: () =>
      api.get<{ forecasts: ForecastWeek[]; totalForecast: number }>('/intelligence/forecasts').then(r => r.data),
    staleTime: 5 * 60_000,
  });

  type ForecastSortKey = 'label' | 'rentalCount' | 'encaisse' | 'previsionnel' | 'totalPayout';
  const [fcSortKey, setFcSortKey] = useState<ForecastSortKey>('label');
  const [fcSortDir, setFcSortDir] = useState<'asc' | 'desc'>('asc');

  function toggleFcSort(k: ForecastSortKey) {
    if (fcSortKey === k) setFcSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setFcSortKey(k); setFcSortDir('asc'); }
  }

  const forecasts = [...(data?.forecasts ?? [])].sort((a, b) => {
    let cmp = 0;
    if (fcSortKey === 'label') cmp = a.label.localeCompare(b.label);
    else cmp = (a[fcSortKey] as number) - (b[fcSortKey] as number);
    return fcSortDir === 'desc' ? -cmp : cmp;
  });
  const totalEncaisse = forecasts.reduce((s, f) => s + f.encaisse, 0);
  const totalPrevisionnel = forecasts.reduce((s, f) => s + f.previsionnel, 0);
  const totalLocations = forecasts.reduce((s, f) => s + f.rentalCount, 0);

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Prévisions</h1>
        <p className="mt-1 text-sm text-gray-500">Projections de revenus sur 8 semaines glissantes</p>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Encaissé (paiements reçus)', value: totalEncaisse, color: 'text-[#01696e]' },
          { label: 'Prévisionnel (à venir)', value: totalPrevisionnel, color: 'text-indigo-600' },
          { label: 'Locations (8 sem.)', value: totalLocations, color: 'text-gray-900', isCount: true },
        ].map(kpi => (
          <div key={kpi.label} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="text-xs text-gray-500">{kpi.label}</p>
            {isLoading
              ? <div className="mt-2 h-7 w-2/3 animate-pulse rounded bg-gray-100" />
              : <p className={`mt-1 text-2xl font-bold ${kpi.color}`}>
                  {kpi.isCount ? kpi.value : fmtEuro(kpi.value)}
                </p>
            }
          </div>
        ))}
      </div>

      {/* Graphique */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-gray-900">Revenus semaine par semaine</h2>
        {isLoading ? (
          <div className="h-64 animate-pulse rounded bg-gray-100" />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={forecasts} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
              <defs>
                <linearGradient id="fg-encaisse" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#01696e" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#01696e" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="fg-previsionnel" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${v}€`} width={55} />
              <Tooltip
                formatter={(v: unknown, name: string) => [
                  fmtEuro(Number(v)),
                  name === 'encaisse' ? 'Encaissé' : 'Prévisionnel',
                ]}
              />
              <Legend formatter={(v: string) => v === 'encaisse' ? 'Encaissé' : 'Prévisionnel'} />
              <Area type="monotone" dataKey="encaisse" stroke="#01696e" strokeWidth={2} fill="url(#fg-encaisse)" />
              <Area type="monotone" dataKey="previsionnel" stroke="#6366f1" strokeWidth={2} fill="url(#fg-previsionnel)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Tableau */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-900">Détail par semaine</h2>
        </div>
        {isLoading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-4 animate-pulse rounded bg-gray-100" />
            ))}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                {(['label', 'rentalCount', 'encaisse', 'previsionnel', 'totalPayout'] as ForecastSortKey[]).map(k => (
                  <th key={k} onClick={() => toggleFcSort(k)}
                    className={`px-5 py-3 font-medium cursor-pointer select-none hover:text-gray-800 transition-colors ${k === 'label' ? 'text-left' : 'text-right'} ${fcSortKey === k ? 'text-[#01696e]' : ''}`}>
                    {k === 'label' ? 'Semaine' : k === 'rentalCount' ? 'Locations' : k === 'encaisse' ? 'Encaissé' : k === 'previsionnel' ? 'Prévisionnel' : 'Total'}
                    {fcSortKey === k ? (fcSortDir === 'desc' ? ' ↓' : ' ↑') : ' ↕'}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {forecasts.map((f, i) => (
                <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-5 py-3 text-gray-700">{f.label}</td>
                  <td className="px-5 py-3 text-right text-gray-600">{f.rentalCount}</td>
                  <td className="px-5 py-3 text-right font-medium text-[#01696e]">{fmtEuro(f.encaisse)}</td>
                  <td className="px-5 py-3 text-right text-indigo-600">{fmtEuro(f.previsionnel)}</td>
                  <td className="px-5 py-3 text-right font-bold text-gray-900">{fmtEuro(f.totalPayout)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
