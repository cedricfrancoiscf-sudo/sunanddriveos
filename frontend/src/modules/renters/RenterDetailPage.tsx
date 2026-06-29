import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../utils/api';
import { useAuth } from '../../hooks/useAuth';

interface RentalHistory {
  id: string;
  vehicleLicensePlate: string;
  startAt: string;
  endAt: string;
  status: string;
  kmDriven: number | null;
  ca: number;
  evaluationRating: number | null;
  lateReturnFee: number | null;
  damageCompensation: number | null;
  gasRefillFee: number | null;
  driverMessFee: number | null;
}

interface RenterProfile {
  driverName: string;
  driverGetaroundId: string;
  totalRentals: number;
  totalKm: number;
  avgKmPerRental: number;
  totalRevenue: number;
  avgRevenue: number;
  avgRating: number | null;
  nbIncidents: number;
  isBlacklisted: boolean;
  blacklistReason: string | null;
  isVip: boolean;
  firstRentalAt: string | null;
  lastRentalAt: string | null;
  vehicles: string[];
  rentals: RentalHistory[];
}

const PRIMARY = '#01696e';

function fmtEuro(v: number): string {
  return v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
}

function fmtDate(s: string | null): string {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateShort(s: string): string {
  return new Date(s).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

const STATUS_LABELS: Record<string, string> = {
  completed: 'Terminée',
  active: 'En cours',
  booked: 'Réservée',
  cancelled: 'Annulée',
};

export default function RenterDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [showBlacklistModal, setShowBlacklistModal] = useState(false);
  const [blacklistReason, setBlacklistReason] = useState('');
  type RentalSortKey = 'startAt' | 'kmDriven' | 'ca' | 'evaluationRating';
  const [rentalSortKey, setRentalSortKey] = useState<RentalSortKey>('startAt');
  const [rentalSortDir, setRentalSortDir] = useState<'asc' | 'desc'>('desc');

  function toggleRentalSort(k: RentalSortKey) {
    if (rentalSortKey === k) setRentalSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setRentalSortKey(k); setRentalSortDir('desc'); }
  }

  function RentalSortTh({ k, label, align }: { k: RentalSortKey; label: string; align: 'left' | 'right' | 'center' }): React.JSX.Element {
    const active = rentalSortKey === k;
    return (
      <th className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wide cursor-pointer select-none hover:text-gray-600 transition-colors text-${align} ${active ? 'text-[#01696e]' : 'text-gray-400'}`}
        onClick={() => toggleRentalSort(k)}>
        {label}{active ? (rentalSortDir === 'desc' ? ' ↓' : ' ↑') : ' ↕'}
      </th>
    );
  }

  const userRoles = user?.roles ?? (user?.role ? [user.role] : []);
  const isCarkeeperOnly = userRoles.includes('carkeeper') && !userRoles.includes('admin') && !userRoles.includes('exploitation') && !user?.isSuperAdmin;

  const { data, isLoading, isError } = useQuery<RenterProfile>({
    queryKey: ['renter-profile', id],
    queryFn: () => api.get<RenterProfile>(`/rentals/renter/${id}/profile`).then(r => r.data),
    enabled: !!id,
    staleTime: 5 * 60_000,
  });

  const blacklistMut = useMutation({
    mutationFn: (reason: string) => api.post('/blacklist/renter', {
      driverGetaroundId: id,
      driverName: data?.driverName ?? '',
      reason,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['renter-profile', id] });
      void qc.invalidateQueries({ queryKey: ['renters'] });
      setShowBlacklistModal(false);
      setBlacklistReason('');
    },
  });

  const unblacklistMut = useMutation({
    mutationFn: () => api.delete(`/blacklist/renter/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['renter-profile', id] });
      void qc.invalidateQueries({ queryKey: ['renters'] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex h-full min-h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-t-transparent"
          style={{ borderColor: PRIMARY, borderTopColor: 'transparent' }} />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm text-gray-500">Locataire introuvable.</p>
        <button type="button" onClick={() => navigate('/renters')}
          className="mt-3 text-sm font-medium" style={{ color: PRIMARY }}>
          ← Retour aux locataires
        </button>
      </div>
    );
  }

  const hasIncidentRentals = data.rentals.filter(r =>
    (r.lateReturnFee ?? 0) > 0 || (r.damageCompensation ?? 0) > 0 ||
    (r.gasRefillFee ?? 0) > 0 || (r.driverMessFee ?? 0) > 0
  );

  return (
    <div className="p-4 lg:p-6 max-w-5xl space-y-5">
      {/* Blacklist modal */}
      {showBlacklistModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-xl space-y-4">
            <h3 className="text-sm font-semibold text-gray-900">Blacklister {data.driverName}</h3>
            <p className="text-xs text-gray-500">Cette action est réversible. Renseignez le motif.</p>
            <textarea
              value={blacklistReason}
              onChange={e => setBlacklistReason(e.target.value)}
              placeholder="Motif de blacklistage…"
              rows={3}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-red-400 resize-none"
            />
            <div className="flex gap-2">
              <button type="button" onClick={() => blacklistMut.mutate(blacklistReason)}
                disabled={!blacklistReason.trim() || blacklistMut.isPending}
                className="flex-1 rounded-xl bg-red-600 py-2 text-sm font-semibold text-white disabled:opacity-60">
                {blacklistMut.isPending ? 'En cours…' : 'Blacklister'}
              </button>
              <button type="button" onClick={() => setShowBlacklistModal(false)}
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <button type="button" onClick={() => navigate('/renters')}
            className="mb-2 flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 transition">
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Locataires
          </button>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold text-gray-900">{data.driverName}</h1>
            {data.isVip && (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">⭐ VIP</span>
            )}
            {!data.isVip && (data.totalRentals >= 3 || data.totalRevenue >= 500) && (
              <span className="rounded-full border border-amber-100 bg-amber-50/50 px-2.5 py-0.5 text-xs font-medium text-amber-500">Potentiellement VIP 🌟</span>
            )}
            {data.isBlacklisted && (
              <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700">🚫 Blacklisté</span>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-1">ID Getaround : {data.driverGetaroundId}</p>
        </div>
        {!isCarkeeperOnly && (
          <div>
            {data.isBlacklisted ? (
              <button type="button"
                onClick={() => { if (confirm(`Retirer ${data.driverName} de la liste noire ?`)) unblacklistMut.mutate(); }}
                disabled={unblacklistMut.isPending}
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60">
                {unblacklistMut.isPending ? '…' : 'Retirer du blacklist'}
              </button>
            ) : (
              <button type="button" onClick={() => setShowBlacklistModal(true)}
                className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-100 transition">
                ⛔ Blacklister
              </button>
            )}
          </div>
        )}
      </div>

      {/* Raison blacklist */}
      {data.isBlacklisted && data.blacklistReason && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-xs font-semibold text-red-700 mb-0.5">Motif de blacklistage</p>
          <p className="text-sm text-red-600">{data.blacklistReason}</p>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-gray-500">Locations</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{data.totalRentals}</p>
          <p className="text-xs text-gray-400 mt-0.5">{fmtDate(data.firstRentalAt)} → {fmtDate(data.lastRentalAt)}</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-gray-500">CA total</p>
          <p className="mt-1 text-2xl font-bold text-green-700">{fmtEuro(data.totalRevenue)}</p>
          <p className="text-xs text-gray-400 mt-0.5">Moy. {fmtEuro(data.avgRevenue)}/location</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-gray-500">Km parcourus</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{data.totalKm.toLocaleString('fr-FR')}</p>
          <p className="text-xs text-gray-400 mt-0.5">Moy. {data.avgKmPerRental.toLocaleString('fr-FR')} km/location</p>
        </div>
        <div className={`rounded-2xl border p-4 shadow-sm ${data.nbIncidents > 0 ? 'border-orange-100 bg-orange-50' : 'border-green-100 bg-green-50'}`}>
          <p className="text-xs font-medium text-gray-500">Incidents</p>
          <p className={`mt-1 text-2xl font-bold ${data.nbIncidents > 0 ? 'text-orange-700' : 'text-green-700'}`}>{data.nbIncidents}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {data.avgRating !== null ? `Note moy. ${data.avgRating}/5 ★` : 'Aucune évaluation'}
          </p>
        </div>
      </div>

      {/* Véhicules utilisés */}
      {data.vehicles.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-gray-500">Véhicules :</span>
          {data.vehicles.map(p => (
            <span key={p} className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-700">{p}</span>
          ))}
        </div>
      )}

      {/* Historique des locations */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Historique des locations</h2>
          <span className="text-xs text-gray-400">{data.rentals.length} locations</span>
        </div>
        {data.rentals.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-400">Aucune location</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                  <th className="px-5 py-2.5 text-left">Véhicule</th>
                  <RentalSortTh k="startAt" label="Période" align="left" />
                  <RentalSortTh k="kmDriven" label="Km" align="right" />
                  <RentalSortTh k="ca" label="CA" align="right" />
                  <RentalSortTh k="evaluationRating" label="Note" align="center" />
                  <th className="px-4 py-2.5 text-center">Statut</th>
                  <th className="px-4 py-2.5 text-center">Frais</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {[...data.rentals].sort((a, b) => {
                  let cmp = 0;
                  if (rentalSortKey === 'startAt') cmp = new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
                  else if (rentalSortKey === 'kmDriven') cmp = (a.kmDriven ?? 0) - (b.kmDriven ?? 0);
                  else if (rentalSortKey === 'ca') cmp = a.ca - b.ca;
                  else if (rentalSortKey === 'evaluationRating') cmp = (a.evaluationRating ?? 0) - (b.evaluationRating ?? 0);
                  return rentalSortDir === 'desc' ? -cmp : cmp;
                }).map(r => {
                  const hasExtra = (r.lateReturnFee ?? 0) > 0 || (r.damageCompensation ?? 0) > 0 ||
                    (r.gasRefillFee ?? 0) > 0 || (r.driverMessFee ?? 0) > 0;
                  return (
                    <tr key={r.id} className={`hover:bg-gray-50/50 ${hasExtra ? 'bg-orange-50/30' : ''}`}>
                      <td className="px-5 py-2.5">
                        <span className="font-mono text-xs font-semibold text-gray-700 bg-gray-100 rounded px-1.5 py-0.5">{r.vehicleLicensePlate}</span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-600 text-xs">
                        {fmtDateShort(r.startAt)} → {fmtDateShort(r.endAt)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-600">{r.kmDriven != null ? `${r.kmDriven.toLocaleString('fr-FR')} km` : '—'}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-green-700">{fmtEuro(r.ca)}</td>
                      <td className="px-4 py-2.5 text-center">
                        {r.evaluationRating != null
                          ? <span className="text-yellow-500 text-xs">{'★'.repeat(r.evaluationRating)}{'☆'.repeat(5 - r.evaluationRating)}</span>
                          : <span className="text-gray-300 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          r.status === 'completed' ? 'bg-green-100 text-green-700'
                          : r.status === 'active' ? 'bg-blue-100 text-blue-700'
                          : r.status === 'cancelled' ? 'bg-gray-100 text-gray-500'
                          : 'bg-orange-100 text-orange-700'
                        }`}>
                          {STATUS_LABELS[r.status] ?? r.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {hasExtra ? (
                          <div className="flex flex-col gap-0.5 items-center">
                            {(r.lateReturnFee ?? 0) > 0 && <span className="text-[9px] rounded bg-red-100 text-red-600 px-1">Retard</span>}
                            {(r.damageCompensation ?? 0) > 0 && <span className="text-[9px] rounded bg-red-100 text-red-600 px-1">Dégât</span>}
                            {(r.gasRefillFee ?? 0) > 0 && <span className="text-[9px] rounded bg-orange-100 text-orange-600 px-1">Carburant</span>}
                            {(r.driverMessFee ?? 0) > 0 && <span className="text-[9px] rounded bg-orange-100 text-orange-600 px-1">Propreté</span>}
                          </div>
                        ) : (
                          <span className="text-green-500 text-xs">✓</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
