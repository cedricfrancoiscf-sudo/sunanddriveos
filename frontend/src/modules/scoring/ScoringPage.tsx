import React, { useState, useEffect } from 'react';
import { trackEvent } from '../../utils/tracking';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { api } from '../../utils/api';

type Tier = 'excellent' | 'good' | 'average' | 'poor';

interface DriverSummary {
  key: string;
  name: string;
  email: string | null;
  rentalCount: number;
  lastRentalAt: string;
  totalRevenue: number;
  score: number;
  tier: Tier;
  breakdown: Record<string, number>;
}

interface DriverDetail {
  key: string;
  name: string;
  email: string | null;
  rentalCount: number;
  lastRentalAt: string;
  totalRevenue: number;
  totalKm: number;
  score: number;
  tier: Tier;
  breakdown: Record<string, number>;
}

interface RentalRow {
  id: string;
  startAt: string;
  endAt: string;
  evaluationRating: number | null;
  evaluationComment: string | null;
  damageCompensation: number | null;
  lateReturnFee: number | null;
  driverMessFee: number | null;
  gasRefillFee: number | null;
  grossRevenue: number | null;
  kmDriven: number | null;
  vehicle: { make: string; model: string; licensePlate: string };
  incidents: Array<{ id: string; type: string; status: string; cost: number | null }>;
}

interface DriversResponse {
  drivers: DriverSummary[];
  stats: {
    total: number;
    excellent: number;
    good: number;
    average: number;
    poor: number;
    avgScore: number;
  };
  total: number;
}

interface DriverDetailResponse {
  driver: DriverDetail;
  rentals: RentalRow[];
}

const TIER_CONFIG: Record<Tier, { label: string; bg: string; text: string; ring: string; bar: string }> = {
  excellent: { label: 'Excellent', bg: 'bg-emerald-100', text: 'text-emerald-700', ring: 'ring-emerald-200', bar: 'bg-emerald-500' },
  good:      { label: 'Bon',       bg: 'bg-blue-100',    text: 'text-blue-700',    ring: 'ring-blue-200',    bar: 'bg-blue-500' },
  average:   { label: 'Moyen',     bg: 'bg-orange-100',  text: 'text-orange-700',  ring: 'ring-orange-200',  bar: 'bg-orange-500' },
  poor:      { label: 'Mauvais',   bg: 'bg-red-100',     text: 'text-red-700',     ring: 'ring-red-200',     bar: 'bg-red-500' },
};

const BREAKDOWN_LABELS: Record<string, string> = {
  rating: 'Notes Getaround',
  damage: 'Dommages',
  lateReturn: 'Retards',
  messFee: 'Frais messagerie',
  gasFee: 'Frais carburant',
  loyalty: 'Bonus fidélité',
};

const TIER_FILTERS: Array<{ value: Tier | ''; label: string }> = [
  { value: '', label: 'Tous' },
  { value: 'excellent', label: 'Excellent (≥90)' },
  { value: 'good', label: 'Bon (75–89)' },
  { value: 'average', label: 'Moyen (50–74)' },
  { value: 'poor', label: 'Mauvais (<50)' },
];

function ScoreBadge({ score, tier }: { score: number; tier: Tier }): React.JSX.Element {
  const cfg = TIER_CONFIG[tier];
  return (
    <div className="flex items-center gap-2">
      <div className="relative flex h-10 w-10 items-center justify-center">
        <svg className="absolute inset-0 h-10 w-10 -rotate-90" viewBox="0 0 36 36">
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="#e5e7eb" strokeWidth="3" />
          <circle
            cx="18" cy="18" r="15.9" fill="none"
            stroke={tier === 'excellent' ? '#10b981' : tier === 'good' ? '#3b82f6' : tier === 'average' ? '#f97316' : '#ef4444'}
            strokeWidth="3"
            strokeDasharray={`${score} 100`}
            strokeLinecap="round"
          />
        </svg>
        <span className="text-xs font-bold text-gray-800">{score}</span>
      </div>
      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cfg.bg} ${cfg.text}`}>
        {cfg.label}
      </span>
    </div>
  );
}

function Stars({ rating }: { rating: number | null }): React.JSX.Element {
  if (rating === null) return <span className="text-gray-300 text-xs">—</span>;
  return (
    <span className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <svg key={i} className={`h-3.5 w-3.5 ${i <= rating ? 'text-yellow-400' : 'text-gray-200'}`}
          fill="currentColor" viewBox="0 0 20 20">
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
    </span>
  );
}

export default function ScoringPage(): React.JSX.Element {
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState<Tier | ''>('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  useEffect(() => { void trackEvent('scoring', 'view'); }, []);

  const { data, isLoading } = useQuery<DriversResponse>({
    queryKey: ['scoring-drivers', tierFilter, search],
    queryFn: () => api.get('/scoring/drivers', {
      params: { tier: tierFilter || undefined, search: search || undefined, limit: 200 },
    }).then(r => r.data as DriversResponse),
  });

  const { data: detail, isLoading: detailLoading } = useQuery<DriverDetailResponse>({
    queryKey: ['scoring-driver', selectedKey],
    queryFn: () => api.get(`/scoring/drivers/${encodeURIComponent(selectedKey!)}`).then(r => r.data as DriverDetailResponse),
    enabled: Boolean(selectedKey),
  });

  const drivers = data?.drivers ?? [];
  const stats = data?.stats;

  return (
    <div className="p-4 lg:p-6">
      {/* Titre */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Scoring conducteurs</h1>
        <p className="mt-1 text-sm text-gray-500">Score calculé sur l'historique complet des locations</p>
      </div>

      {/* KPI cards */}
      {stats && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div className="rounded-xl border border-gray-200 bg-white p-4 text-center">
            <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
            <p className="text-xs text-gray-400 mt-0.5">Conducteurs</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 text-center">
            <p className="text-2xl font-bold text-gray-700">{stats.avgScore}</p>
            <p className="text-xs text-gray-400 mt-0.5">Score moyen</p>
          </div>
          {(['excellent', 'good', 'average', 'poor'] as Tier[]).map(tier => {
            const cfg = TIER_CONFIG[tier];
            return (
              <button
                key={tier}
                type="button"
                onClick={() => setTierFilter(f => f === tier ? '' : tier)}
                className={`rounded-xl border p-4 text-center transition-all ${
                  tierFilter === tier ? `ring-2 ${cfg.ring} ${cfg.bg}` : 'border-gray-200 bg-white hover:bg-gray-50'
                }`}
              >
                <p className={`text-2xl font-bold ${cfg.text}`}>{stats[tier]}</p>
                <p className="text-xs text-gray-400 mt-0.5">{cfg.label}</p>
              </button>
            );
          })}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Liste conducteurs */}
        <div className={selectedKey ? 'lg:col-span-1' : 'lg:col-span-3'}>
          {/* Barre de recherche */}
          <div className="mb-3 flex gap-2">
            <input
              type="text"
              placeholder="Rechercher un conducteur..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#01696e]/30"
            />
            {tierFilter && (
              <button
                type="button"
                onClick={() => setTierFilter('')}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-500 hover:bg-gray-50"
              >
                ✕
              </button>
            )}
          </div>

          {/* Filtre tiers (compact si panneau détail ouvert) */}
          {!selectedKey && (
            <div className="mb-3 flex flex-wrap gap-2">
              {TIER_FILTERS.map(f => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setTierFilter(f.value as Tier | '')}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    tierFilter === f.value
                      ? 'bg-[#01696e] text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}

          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            {isLoading ? (
              <div className="flex justify-center py-12">
                <div className="h-6 w-6 animate-spin rounded-full border-4 border-t-transparent" style={{ borderColor: '#01696e', borderTopColor: 'transparent' }} />
              </div>
            ) : drivers.length === 0 ? (
              <div className="py-12 text-center text-sm text-gray-400">Aucun conducteur</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {drivers.map(d => (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => setSelectedKey(s => s === d.key ? null : d.key)}
                    className={`w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors ${
                      selectedKey === d.key ? 'bg-[#01696e]/5 border-l-2 border-[#01696e]' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-gray-900 truncate">{d.name}</p>
                        <p className="text-xs text-gray-400 truncate">{d.email ?? 'Email non renseigné'}</p>
                        <div className="mt-1 flex items-center gap-3 text-xs text-gray-400">
                          <span>{d.rentalCount} location{d.rentalCount > 1 ? 's' : ''}</span>
                          <span>{d.totalRevenue.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0 })}</span>
                        </div>
                      </div>
                      <ScoreBadge score={d.score} tier={d.tier} />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Panneau détail conducteur */}
        {selectedKey && (
          <div className="lg:col-span-2">
            <div className="rounded-xl border border-gray-200 bg-white">
              {detailLoading || !detail ? (
                <div className="flex justify-center py-16">
                  <div className="h-6 w-6 animate-spin rounded-full border-4 border-t-transparent" style={{ borderColor: '#01696e', borderTopColor: 'transparent' }} />
                </div>
              ) : (
                <>
                  {/* En-tête conducteur */}
                  <div className="border-b border-gray-100 p-5">
                    <div className="flex items-start justify-between">
                      <div>
                        <h2 className="text-lg font-bold text-gray-900">{detail.driver.name}</h2>
                        {detail.driver.email && <p className="text-sm text-gray-400">{detail.driver.email}</p>}
                        <div className="mt-2 flex flex-wrap gap-4 text-sm text-gray-500">
                          <span>{detail.driver.rentalCount} locations</span>
                          <span>{detail.driver.totalKm.toLocaleString('fr-FR')} km parcourus</span>
                          <span>{detail.driver.totalRevenue.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0 })} CA total</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <ScoreBadge score={detail.driver.score} tier={detail.driver.tier} />
                      </div>
                    </div>

                    {/* Breakdown du score */}
                    {Object.keys(detail.driver.breakdown).length > 0 && (
                      <div className="mt-4 grid grid-cols-2 gap-2">
                        {Object.entries(detail.driver.breakdown).map(([key, val]) => (
                          <div key={key} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-xs">
                            <span className="text-gray-500">{BREAKDOWN_LABELS[key] ?? key}</span>
                            <span className={`font-semibold ${val >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                              {val > 0 ? '+' : ''}{val}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Historique des locations */}
                  <div className="p-5">
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
                      Historique des locations
                    </h3>
                    <div className="space-y-2 max-h-[500px] overflow-y-auto">
                      {detail.rentals.map(r => (
                        <div key={r.id} className="rounded-lg border border-gray-100 px-3 py-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-900">
                                {r.vehicle.make} {r.vehicle.model}
                                <span className="ml-2 font-mono text-xs text-gray-400">{r.vehicle.licensePlate}</span>
                              </p>
                              <p className="text-xs text-gray-400 mt-0.5">
                                {format(new Date(r.startAt), 'dd/MM/yyyy', { locale: fr })} → {format(new Date(r.endAt), 'dd/MM/yyyy', { locale: fr })}
                                {r.kmDriven ? ` · ${r.kmDriven} km` : ''}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <Stars rating={r.evaluationRating} />
                              {r.grossRevenue != null && (
                                <span className="text-xs font-medium text-gray-600">
                                  {r.grossRevenue.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0 })}
                                </span>
                              )}
                            </div>
                          </div>
                          {/* Frais négatifs */}
                          {((r.damageCompensation ?? 0) > 0 || (r.lateReturnFee ?? 0) > 0 || (r.driverMessFee ?? 0) > 0 || (r.gasRefillFee ?? 0) > 0) && (
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {(r.damageCompensation ?? 0) > 0 && (
                                <span className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] text-red-700">
                                  Dommage {r.damageCompensation?.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0 })}
                                </span>
                              )}
                              {(r.lateReturnFee ?? 0) > 0 && (
                                <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[11px] text-orange-700">
                                  Retard {r.lateReturnFee?.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0 })}
                                </span>
                              )}
                              {(r.driverMessFee ?? 0) > 0 && (
                                <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[11px] text-purple-700">
                                  Messagerie
                                </span>
                              )}
                              {(r.gasRefillFee ?? 0) > 0 && (
                                <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-[11px] text-yellow-700">
                                  Carburant
                                </span>
                              )}
                            </div>
                          )}
                          {r.evaluationComment && (
                            <p className="mt-1.5 text-xs italic text-gray-400">"{r.evaluationComment}"</p>
                          )}
                          {r.incidents.length > 0 && (
                            <p className="mt-1 text-xs text-red-500">
                              {r.incidents.length} incident{r.incidents.length > 1 ? 's' : ''} lié{r.incidents.length > 1 ? 's' : ''}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
