import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../utils/api';

interface Renter {
  driverGetaroundId: string;
  name: string;
  rentalCount: number;
  totalCA: number;
  totalKm: number;
  lastRentalAt: string;
  avgRating: number | null;
  isBlacklisted: boolean;
  isVip: boolean;
}

function fmtEuro(v: number): string {
  return v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
}

function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function RentersPage(): React.JSX.Element {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'vip' | 'blacklisted'>('all');

  const { data, isLoading } = useQuery<{ renters: Renter[]; total: number }>({
    queryKey: ['renters'],
    queryFn: () => api.get<{ renters: Renter[]; total: number }>('/renters').then(r => r.data),
    staleTime: 5 * 60_000,
  });

  const renters = data?.renters ?? [];

  const filtered = renters.filter(r => {
    const matchSearch = !search || r.name.toLowerCase().includes(search.toLowerCase());
    const matchFilter =
      filter === 'all' ||
      (filter === 'vip' && r.isVip) ||
      (filter === 'blacklisted' && r.isBlacklisted);
    return matchSearch && matchFilter;
  });

  const vipCount = renters.filter(r => r.isVip).length;
  const blacklistedCount = renters.filter(r => r.isBlacklisted).length;

  return (
    <div className="p-4 lg:p-6 max-w-6xl space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Locataires</h1>
        <p className="text-sm text-gray-500">Historique et profils conducteurs</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-gray-500">Total locataires</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{renters.length}</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-gray-500">VIP (≥ 5 locations)</p>
          <p className="mt-1 text-2xl font-bold text-amber-600">{vipCount}</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-gray-500">Blacklistés</p>
          <p className="mt-1 text-2xl font-bold text-red-600">{blacklistedCount}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <input
          type="text"
          placeholder="Rechercher par nom..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="rounded-xl border border-gray-200 px-4 py-2 text-sm outline-none focus:border-[#01696e] w-64"
        />
        <div className="flex gap-1 rounded-lg border border-gray-200 bg-gray-50 p-0.5">
          {(['all', 'vip', 'blacklisted'] as const).map(f => (
            <button key={f} type="button" onClick={() => setFilter(f)}
              className={`rounded px-3 py-1 text-xs font-medium transition ${filter === f ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
              {f === 'all' ? 'Tous' : f === 'vip' ? 'VIP' : 'Blacklistés'}
            </button>
          ))}
        </div>
        {filtered.length !== renters.length && (
          <span className="text-xs text-gray-400">{filtered.length} résultat{filtered.length !== 1 ? 's' : ''}</span>
        )}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-t-transparent"
              style={{ borderColor: '#01696e', borderTopColor: 'transparent' }} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400">
            {search || filter !== 'all' ? 'Aucun locataire trouvé' : 'Aucune location enregistrée'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500">Nom</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">Locations</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">CA total</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">Km total</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">Note moy.</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">Dernière loc.</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(r => (
                  <tr key={r.driverGetaroundId} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-5 py-3">
                      <span className="font-medium text-gray-900">{r.name}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">{r.rentalCount}</td>
                    <td className="px-4 py-3 text-right font-semibold text-green-700">{fmtEuro(r.totalCA)}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{r.totalKm.toLocaleString('fr-FR')} km</td>
                    <td className="px-4 py-3 text-right text-gray-600">
                      {r.avgRating != null ? `${r.avgRating}/5` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-gray-500">{fmtDate(r.lastRentalAt)}</td>
                    <td className="px-5 py-3 text-right">
                      {r.isBlacklisted ? (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">Blacklisté</span>
                      ) : r.isVip ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">VIP</span>
                      ) : (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500">Normal</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
