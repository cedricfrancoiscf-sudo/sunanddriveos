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
  score: number;
  tier: 'excellent' | 'good' | 'average' | 'poor';
}

function fmtEuro(v: number): string {
  return v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
}

function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

const PRIMARY = '#01696e';

type SortKey = 'name' | 'rentalCount' | 'totalCA' | 'totalKm' | 'score' | 'lastRentalAt';
type FilterKey = 'all' | 'vip' | 'blacklisted' | 'excellent' | 'good' | 'average' | 'poor';

function ScoreBadge({ score, tier }: { score: number; tier: string }): React.JSX.Element {
  const cfg = {
    excellent: { bg: 'bg-green-100', text: 'text-green-700', label: 'Excellent' },
    good:      { bg: 'bg-blue-100',  text: 'text-blue-700',  label: 'Bon' },
    average:   { bg: 'bg-orange-100',text: 'text-orange-700',label: 'Moyen' },
    poor:      { bg: 'bg-red-100',   text: 'text-red-700',   label: 'Mauvais' },
  }[tier] ?? { bg: 'bg-gray-100', text: 'text-gray-700', label: '—' };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${cfg.bg} ${cfg.text}`}>
      {score} · {cfg.label}
    </span>
  );
}

export default function RentersPage(): React.JSX.Element {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [sortKey, setSortKey] = useState<SortKey>('totalCA');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const { data, isLoading } = useQuery<{ renters: Renter[]; total: number }>({
    queryKey: ['renters'],
    queryFn: () => api.get<{ renters: Renter[]; total: number }>('/renters').then(r => r.data),
    staleTime: 5 * 60_000,
  });

  const renters = data?.renters ?? [];

  const filtered = renters
    .filter(r => {
      const matchSearch = !search || r.name.toLowerCase().includes(search.toLowerCase());
      const matchFilter =
        filter === 'all' ||
        (filter === 'vip' && r.isVip) ||
        (filter === 'blacklisted' && r.isBlacklisted) ||
        (filter === 'excellent' && r.tier === 'excellent') ||
        (filter === 'good' && r.tier === 'good') ||
        (filter === 'average' && r.tier === 'average') ||
        (filter === 'poor' && r.tier === 'poor');
      return matchSearch && matchFilter;
    })
    .sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'name') cmp = a.name.localeCompare(b.name, 'fr');
      else if (sortKey === 'lastRentalAt') cmp = new Date(a.lastRentalAt).getTime() - new Date(b.lastRentalAt).getTime();
      else cmp = (a[sortKey] as number) - (b[sortKey] as number);
      return sortDir === 'desc' ? -cmp : cmp;
    });

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('desc'); }
  }

  function SortTh({ k, label, right }: { k: SortKey; label: string; right?: boolean }): React.JSX.Element {
    const active = sortKey === k;
    return (
      <th
        className={`px-4 py-3 text-xs font-semibold cursor-pointer select-none hover:opacity-80 ${right ? 'text-right' : 'text-left'}`}
        style={{ color: active ? PRIMARY : '#6b7280' }}
        onClick={() => toggleSort(k)}
      >
        {label}{active ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
      </th>
    );
  }

  const countExcellent = renters.filter(r => r.tier === 'excellent').length;
  const countGood = renters.filter(r => r.tier === 'good').length;
  const countAverage = renters.filter(r => r.tier === 'average').length;
  const countPoor = renters.filter(r => r.tier === 'poor').length;
  const avgScore = renters.length > 0 ? Math.round(renters.reduce((s, r) => s + r.score, 0) / renters.length) : 0;

  const filters: { key: FilterKey; label: string }[] = [
    { key: 'all', label: 'Tous' },
    { key: 'vip', label: 'VIP' },
    { key: 'blacklisted', label: 'Blacklistés' },
    { key: 'excellent', label: 'Excellent' },
    { key: 'good', label: 'Bon' },
    { key: 'average', label: 'Moyen' },
    { key: 'poor', label: 'Mauvais' },
  ];

  return (
    <div className="p-4 lg:p-6 max-w-6xl space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Locataires</h1>
        <p className="text-sm text-gray-500">Historique et scoring conducteurs</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm col-span-2 lg:col-span-2">
          <p className="text-xs font-medium text-gray-500">Total conducteurs</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{renters.length}</p>
          <p className="text-xs text-gray-400 mt-0.5">Score moyen : <span className="font-semibold text-gray-700">{avgScore}</span></p>
        </div>
        <div className="rounded-2xl border border-green-100 bg-green-50 p-4 shadow-sm">
          <p className="text-xs font-medium text-green-700">Excellent</p>
          <p className="mt-1 text-2xl font-bold text-green-700">{countExcellent}</p>
          <p className="text-xs text-green-600">≥ 90</p>
        </div>
        <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 shadow-sm">
          <p className="text-xs font-medium text-blue-700">Bon</p>
          <p className="mt-1 text-2xl font-bold text-blue-700">{countGood}</p>
          <p className="text-xs text-blue-600">≥ 75</p>
        </div>
        <div className="rounded-2xl border border-orange-100 bg-orange-50 p-4 shadow-sm">
          <p className="text-xs font-medium text-orange-700">Moyen</p>
          <p className="mt-1 text-2xl font-bold text-orange-700">{countAverage}</p>
          <p className="text-xs text-orange-600">≥ 50</p>
        </div>
        <div className="rounded-2xl border border-red-100 bg-red-50 p-4 shadow-sm">
          <p className="text-xs font-medium text-red-700">Mauvais</p>
          <p className="mt-1 text-2xl font-bold text-red-700">{countPoor}</p>
          <p className="text-xs text-red-600">&lt; 50</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <input
          type="text"
          placeholder="Rechercher par nom..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="rounded-xl border border-gray-200 px-4 py-2 text-sm outline-none w-64"
        />
        <div className="flex flex-wrap gap-1 rounded-lg border border-gray-200 bg-gray-50 p-0.5">
          {filters.map(f => (
            <button key={f.key} type="button" onClick={() => setFilter(f.key)}
              className={`rounded px-3 py-1 text-xs font-medium transition ${filter === f.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
              {f.label}
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
              style={{ borderColor: PRIMARY, borderTopColor: 'transparent' }} />
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
                  <SortTh k="name" label="Nom" />
                  <SortTh k="rentalCount" label="Locations" right />
                  <SortTh k="totalCA" label="CA total" right />
                  <SortTh k="totalKm" label="Km total" right />
                  <SortTh k="score" label="Score" right />
                  <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500">Statut</th>
                  <SortTh k="lastRentalAt" label="Dernière loc." right />
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
                    <td className="px-4 py-3 text-right">
                      <ScoreBadge score={r.score} tier={r.tier} />
                    </td>
                    <td className="px-5 py-3 text-right">
                      {r.isBlacklisted ? (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">Blacklisté</span>
                      ) : r.isVip ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">VIP</span>
                      ) : (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500">Normal</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-gray-500">{fmtDate(r.lastRentalAt)}</td>
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
