import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer,
} from 'recharts';
import { api } from '../../utils/api';

interface ForecastWeek {
  week: string;
  label: string;
  rentalCount: number;
  encaisse: number;
  previsionnel: number;
  totalPayout: number;
}

interface ForecastsData {
  forecasts: ForecastWeek[];
  totalForecast: number;
}

function fmtEuro(v: number): string {
  return v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
}

export default function ForecastsPage(): React.JSX.Element {
  const { data, isLoading } = useQuery<ForecastsData>({
    queryKey: ['forecasts'],
    queryFn: () => api.get<ForecastsData>('/intelligence/forecasts').then(r => r.data),
    staleTime: 30 * 60_000,
  });

  const forecasts = data?.forecasts ?? [];
  const totalForecast = data?.totalForecast ?? 0;
  const totalEncaisse = forecasts.reduce((s, f) => s + f.encaisse, 0);
  const totalPrevisionnel = forecasts.reduce((s, f) => s + f.previsionnel, 0);
  const totalRentals = forecasts.reduce((s, f) => s + f.rentalCount, 0);

  return (
    <div className="p-4 lg:p-6 max-w-5xl space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Prévisions trésorerie</h1>
        <p className="text-sm text-gray-500">Projections sur 8 semaines glissantes</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-gray-500">Total 8 semaines</p>
          <p className="mt-1 text-xl font-bold text-gray-900">{fmtEuro(totalForecast)}</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-gray-500">Encaissé</p>
          <p className="mt-1 text-xl font-bold text-green-700">{fmtEuro(totalEncaisse)}</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-gray-500">Prévisionnel</p>
          <p className="mt-1 text-xl font-bold text-blue-600">{fmtEuro(totalPrevisionnel)}</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-gray-500">Locations planifiées</p>
          <p className="mt-1 text-xl font-bold text-gray-900">{totalRentals}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-900">CA prévisionnel — 8 semaines</h2>
          <div className="flex gap-3 text-[10px] text-gray-400">
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm inline-block" style={{ backgroundColor: '#16a34a' }} />
              Encaissé
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm inline-block" style={{ backgroundColor: '#60a5fa' }} />
              Prévisionnel
            </span>
          </div>
        </div>
        <div className="p-5">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-t-transparent"
                style={{ borderColor: '#01696e', borderTopColor: 'transparent' }} />
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={forecasts} margin={{ top: 10, right: 10, left: 0, bottom: 48 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 9 }} angle={-30} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${v}€`} />
                <Tooltip
                  formatter={(v: number, name: string) => [
                    fmtEuro(v),
                    name === 'encaisse' ? 'Encaissé' : 'Prévisionnel',
                  ]}
                />
                <Bar dataKey="encaisse" stackId="a" fill="#16a34a" name="encaisse" />
                <Bar dataKey="previsionnel" stackId="a" fill="#60a5fa" radius={[3, 3, 0, 0]} name="previsionnel" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-gray-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-900">Détail semaine par semaine</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500">Semaine</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">Locations</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">Encaissé</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">Prévisionnel</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {forecasts.map((f, i) => (
                <tr key={i} className={i === 0 ? 'bg-[#01696e]/5' : 'hover:bg-gray-50/50 transition-colors'}>
                  <td className="px-5 py-3">
                    <span className="text-gray-700 font-medium">{f.label}</span>
                    {i === 0 && (
                      <span className="ml-2 rounded-full bg-[#01696e]/10 px-2 py-0.5 text-[10px] font-semibold text-[#01696e]">
                        Cette semaine
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600">{f.rentalCount}</td>
                  <td className="px-4 py-3 text-right font-semibold text-green-700">{fmtEuro(f.encaisse)}</td>
                  <td className="px-4 py-3 text-right font-medium text-blue-600">{fmtEuro(f.previsionnel)}</td>
                  <td className="px-5 py-3 text-right">
                    <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-bold text-gray-700">
                      {fmtEuro(f.totalPayout)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
