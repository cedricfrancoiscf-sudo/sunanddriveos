import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, differenceInDays } from 'date-fns';
import { fr } from 'date-fns/locale';
import { api } from '../../utils/api';
import { rentalsApi, type RentalStatus, type EvaluationStatus } from './rentalsApi';
import { useAuth } from '../../hooks/useAuth';

interface RenterProfile {
  driverName: string;
  driverGetaroundId: string;
  totalRentals: number;
  totalKm: number;
  avgKmPerRental: number;
  avgRevenue: number;
  totalRevenue: number;
  incidents: number;
  isBlacklisted: boolean;
  blacklistReason?: string;
  isVip: boolean;
  firstRentalAt: string | null;
  vehicles: string[];
}

const INCIDENT_TYPE_LABELS: Record<string, string> = {
  damage: 'Dommage', theft: 'Vol', accident: 'Accident', vandalism: 'Vandalisme', other: 'Autre',
};
const INCIDENT_STATUS_LABELS: Record<string, string> = {
  open: 'Ouvert', in_progress: 'En cours', resolved: 'Résolu', closed: 'Clôturé',
};

const STATUS_LABELS: Record<RentalStatus, string> = {
  booked: 'Réservée',
  active: 'En cours',
  completed: 'Terminée',
  cancelled: 'Annulée',
};

const STATUS_COLORS: Record<RentalStatus, string> = {
  booked: 'bg-blue-100 text-blue-700',
  active: 'bg-green-100 text-green-700',
  completed: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-red-100 text-red-600',
};

const EVAL_LABELS: Record<EvaluationStatus, string> = {
  pending: 'En attente',
  posted: 'Publiée',
  blocked: 'Bloquée',
};

function Row({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between border-b border-gray-100 py-2.5 last:border-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-900">{value ?? '—'}</span>
    </div>
  );
}

function FinancialRow({ label, value, highlight, negative, colorNegative }: { label: string; value: number | null | undefined; highlight?: boolean; negative?: boolean; colorNegative?: boolean }): React.JSX.Element {
  const displayValue = negative && value != null ? -value : value;
  const isRed = negative || (colorNegative && value != null && value < 0);
  return (
    <div className={`flex items-center justify-between border-b border-gray-100 py-2.5 last:border-0 ${highlight ? 'font-semibold' : ''}`}>
      <span className="text-sm text-gray-500">{label}</span>
      <span className={`text-sm ${highlight ? 'text-gray-900' : isRed ? 'text-red-600' : 'text-gray-700'}`}>
        {displayValue != null
          ? displayValue.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
          : '—'}
      </span>
    </div>
  );
}

function FuelBar({ level, label, alert }: { level: number; label: string; alert?: boolean }): React.JSX.Element {
  const color = level < 25 ? 'bg-red-500' : level < 50 ? 'bg-orange-400' : 'bg-green-500';
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-xs text-gray-500">{label}</span>
      <div className="flex-1 h-2.5 rounded-full bg-gray-100 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${level}%` }} />
      </div>
      <span className={`w-10 text-right text-xs font-semibold ${alert ? 'text-orange-600' : 'text-gray-700'}`}>{Math.round(level)}%</span>
    </div>
  );
}

function Stars({ rating }: { rating: number }): React.JSX.Element {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <svg
          key={s}
          className={`h-4 w-4 ${s <= rating ? 'text-yellow-400' : 'text-gray-200'}`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
    </div>
  );
}

export default function RentalDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.isSuperAdmin;
  const [showIncidentForm, setShowIncidentForm] = useState(false);
  const [incidentForm, setIncidentForm] = useState({ type: 'damage', description: '', cost: '' });

  const { data: rental, isLoading, isError } = useQuery({
    queryKey: ['rental', id],
    queryFn: () => rentalsApi.get(id!),
    enabled: Boolean(id),
    staleTime: 30_000,
  });

  const { data: profile } = useQuery({
    queryKey: ['renter-profile', rental?.driverGetaroundId],
    queryFn: () => api.get<RenterProfile>(`/rentals/renter/${rental!.driverGetaroundId}/profile`).then(r => r.data),
    enabled: Boolean(rental?.driverGetaroundId),
    staleTime: 2 * 60_000,
  });

  const blacklistMutation = useMutation({
    mutationFn: (reason: string) => api.post('/blacklist/renter', {
      driverGetaroundId: rental!.driverGetaroundId,
      driverName: rental!.driverName,
      reason,
    }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['renter-profile', rental?.driverGetaroundId] }),
  });

  const unblacklistMutation = useMutation({
    mutationFn: () => api.delete(`/blacklist/renter/${rental!.driverGetaroundId}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['renter-profile', rental?.driverGetaroundId] }),
  });

  function handleBlacklist() {
    const reason = prompt('Motif de blacklistage :');
    if (reason?.trim()) blacklistMutation.mutate(reason.trim());
  }

  const updateMutation = useMutation({
    mutationFn: (data: Parameters<typeof rentalsApi.update>[1]) => rentalsApi.update(id!, data),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['rental', id] }); },
  });

  const createIncidentMutation = useMutation({
    mutationFn: (data: { vehicleId: string; rentalId: string; type: string; description: string; cost?: number }) =>
      api.post('/incidents', data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['rental', id] });
      setShowIncidentForm(false);
      setIncidentForm({ type: 'damage', description: '', cost: '' });
    },
  });

  const updateIncidentMutation = useMutation({
    mutationFn: ({ incidentId, status }: { incidentId: string; status: string }) =>
      api.put(`/incidents/${incidentId}`, { status }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['rental', id] }),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" style={{ borderColor: '#01696e', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  if (isError || !rental) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Location introuvable.
        </div>
        <Link to="/rentals" className="mt-4 inline-block text-sm text-[#01696e] hover:underline">
          ← Retour aux locations
        </Link>
      </div>
    );
  }

  const duration = differenceInDays(new Date(rental.endAt), new Date(rental.startAt));
  const hasExtraFees =
    (rental.driverMessFee ?? 0) > 0 ||
    (rental.damageCompensation ?? 0) > 0 ||
    (rental.gasRefillFee ?? 0) > 0 ||
    (rental.lateReturnFee ?? 0) > 0;

  return (
    <div className="p-4 lg:p-6">
      {/* Fil d'Ariane */}
      <div className="mb-6 flex items-center gap-2 text-sm">
        <Link to="/rentals" className="text-gray-400 hover:text-gray-600">Locations</Link>
        <span className="text-gray-300">/</span>
        <span className="font-medium text-gray-900">{rental.driverName}</span>
        <span className={`ml-2 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[rental.status]}`}>
          {STATUS_LABELS[rental.status]}
        </span>
        {profile?.isBlacklisted && (
          <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">⛔ Blacklisté</span>
        )}
        {profile?.isVip && (
          <span className="rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-semibold text-yellow-700">⭐ VIP</span>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Colonne principale */}
        <div className="space-y-4 lg:col-span-2">
          {/* Infos générales */}
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h1 className="text-xl font-bold text-gray-900">{rental.driverName}</h1>
                {rental.driverEmail && (
                  <a href={`mailto:${rental.driverEmail}`} className="text-sm text-[#01696e] hover:underline">
                    {rental.driverEmail}
                  </a>
                )}
              </div>
              <Link
                to={`/vehicles/${rental.vehicle.id}`}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                {rental.vehicle.make} {rental.vehicle.model}
              </Link>
            </div>
            <Row
              label="Période"
              value={`${format(new Date(rental.startAt), 'dd MMM yyyy HH:mm', { locale: fr })} → ${format(new Date(rental.endAt), 'dd MMM yyyy HH:mm', { locale: fr })}`}
            />
            <Row label="Durée" value={`${duration} jour${duration !== 1 ? 's' : ''}`} />
            <Row label="Immatriculation" value={<span className="tracking-wide">{rental.vehicle.licensePlate}</span>} />
            {rental.driverGetaroundId && (
              <Row label="ID Getaround" value={`Location #${rental.getaroundId} · Driver #${rental.driverGetaroundId}`} />
            )}
          </div>

          {/* Kilométrage */}
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">Kilométrage</h2>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <label className="mb-1 block text-xs text-gray-500">Départ (km)</label>
                <input
                  type="number"
                  defaultValue={rental.startMileage ?? ''}
                  onBlur={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (!isNaN(v)) updateMutation.mutate({ startMileage: v });
                  }}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]"
                  placeholder="0"
                />
              </div>
              <svg className="h-5 w-5 shrink-0 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
              <div className="flex-1">
                <label className="mb-1 block text-xs text-gray-500">Retour (km)</label>
                <input
                  type="number"
                  defaultValue={rental.endMileage ?? ''}
                  onBlur={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (!isNaN(v)) updateMutation.mutate({ endMileage: v });
                  }}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]"
                  placeholder="0"
                />
              </div>
              {rental.kmDriven != null && (
                <div className="shrink-0 text-right">
                  <p className="text-xs text-gray-400">Parcourus</p>
                  <p className="text-lg font-bold text-gray-900">{rental.kmDriven.toLocaleString('fr-FR')} km</p>
                </div>
              )}
            </div>
          </div>

          {/* Carburant */}
          {(rental.fuelLevelCheckin != null || rental.fuelLevelCheckout != null) && (
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Carburant</h2>
                {rental.fuelLevelCheckin != null && rental.fuelLevelCheckout != null &&
                 rental.fuelLevelCheckout < rental.fuelLevelCheckin - 15 && (
                  <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">
                    ⛽ Insuffisant
                  </span>
                )}
              </div>
              <div className="space-y-2.5">
                {rental.fuelLevelCheckin != null && (
                  <FuelBar level={rental.fuelLevelCheckin} label="Départ" />
                )}
                {rental.fuelLevelCheckout != null && (
                  <FuelBar level={rental.fuelLevelCheckout} label="Retour"
                    alert={rental.fuelLevelCheckin != null && rental.fuelLevelCheckout < rental.fuelLevelCheckin - 15} />
                )}
              </div>
            </div>
          )}

          {/* Messages */}
          {rental.messages.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
                  Messages ({rental._count.messages})
                </h2>
                <Link to={`/messages?rentalId=${rental.id}`} className="text-xs text-[#01696e] hover:underline">
                  Voir tous →
                </Link>
              </div>
              <div className="space-y-2">
                {rental.messages.slice(0, 3).map((m) => (
                  <div
                    key={m.id}
                    className={`rounded-lg p-3 text-sm ${
                      m.direction === 'inbound' ? 'bg-gray-50' : 'bg-[#01696e]/5'
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-gray-400 capitalize">
                        {m.direction === 'inbound' ? 'Locataire' : 'Nous'}
                      </span>
                      {m.sentAt && (
                        <span className="text-xs text-gray-300">
                          {format(new Date(m.sentAt), 'dd/MM HH:mm', { locale: fr })}
                        </span>
                      )}
                    </div>
                    <p className="line-clamp-2 text-gray-700">{m.content}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Colonne droite */}
        <div className="space-y-4">
          {/* Profil locataire */}
          {profile && (
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-400">Profil locataire</h2>
              <div className="space-y-1">
                <Row label="Locations totales" value={String(profile.totalRentals)} />
                <Row label="Km total" value={`${profile.totalKm.toLocaleString('fr-FR')} km`} />
                <Row label="Km moyen" value={`${profile.avgKmPerRental.toLocaleString('fr-FR')} km / loc.`} />
                <Row label="CA moyen" value={profile.avgRevenue.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })} />
                <Row label="Incidents" value={<span className={profile.incidents > 0 ? 'font-semibold text-red-600' : 'text-green-600'}>{profile.incidents}</span>} />
                {profile.firstRentalAt && (
                  <Row label="1ère location" value={format(new Date(profile.firstRentalAt), 'dd/MM/yyyy', { locale: fr })} />
                )}
              </div>
              {profile.vehicles.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1 pt-3 border-t border-gray-100">
                  {profile.vehicles.map(v => (
                    <span key={v} className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-600">{v}</span>
                  ))}
                </div>
              )}
              {profile.isBlacklisted && profile.blacklistReason && (
                <div className="mt-3 rounded-lg bg-red-50 px-3 py-2">
                  <p className="text-xs font-semibold text-red-700">Blacklisté</p>
                  <p className="text-xs text-red-600">{profile.blacklistReason}</p>
                </div>
              )}
              {isAdmin && rental.driverGetaroundId && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  {profile.isBlacklisted ? (
                    <button type="button" onClick={() => { if (confirm('Retirer de la liste noire ?')) unblacklistMutation.mutate(); }}
                      disabled={unblacklistMutation.isPending}
                      className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60">
                      Retirer du blacklist
                    </button>
                  ) : (
                    <button type="button" onClick={handleBlacklist} disabled={blacklistMutation.isPending}
                      className="w-full rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-60">
                      ⛔ Blacklister ce locataire
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Finances */}
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">Finances</h2>

            {/* Composantes — lignes avec valeur non nulle */}
            {(rental.basePrice ?? 0) !== 0 && <FinancialRow label="Location (prix de base)" value={rental.basePrice} />}
            {(rental.insuranceFee ?? 0) !== 0 && <FinancialRow label="Assurance" value={rental.insuranceFee} />}
            {(rental.driverMessFee ?? 0) !== 0 && <FinancialRow label="Nettoyage" value={rental.driverMessFee} />}
            {(rental.damageCompensation ?? 0) !== 0 && <FinancialRow label="Réparations" value={rental.damageCompensation} />}
            {(rental.extraDistanceFee ?? 0) !== 0 && <FinancialRow label="Km supplémentaires" value={rental.extraDistanceFee} />}
            {(rental.gasRefillFee ?? 0) !== 0 && <FinancialRow label="Carburant" value={rental.gasRefillFee} colorNegative />}
            {(() => {
              const r = rental as unknown as Record<string, number | null | undefined>;
              const autres = (r.lateReturnFee ?? 0) + (r.assistanceFee ?? 0) + (r.deliveryFee ?? 0)
                + (r.batteryRechargeFee ?? 0) + (r.ownerInfractionFee ?? 0) + (r.ownerTowFee ?? 0)
                + (r.guaranteeEarning ?? 0) + (r.otherCompensation ?? 0) + (r.cancellationFee ?? 0);
              return autres !== 0 ? <FinancialRow label="Autres" value={autres} /> : null;
            })()}

            {/* Sous-total brut */}
            <div className="my-2 border-t border-gray-100" />
            {(() => {
              const r = rental as unknown as Record<string, number | null | undefined>;
              const compSum = (r.basePrice ?? 0) + (r.insuranceFee ?? 0) + (r.driverMessFee ?? 0)
                + (r.damageCompensation ?? 0) + (r.extraDistanceFee ?? 0) + (r.gasRefillFee ?? 0)
                + (r.lateReturnFee ?? 0) + (r.assistanceFee ?? 0) + (r.deliveryFee ?? 0)
                + (r.batteryRechargeFee ?? 0) + (r.ownerInfractionFee ?? 0) + (r.ownerTowFee ?? 0)
                + (r.guaranteeEarning ?? 0) + (r.otherCompensation ?? 0) + (r.cancellationFee ?? 0);
              const sousTotal = compSum > 0 ? compSum : (rental.grossRevenue ?? null);
              return <FinancialRow label="Sous-total brut" value={sousTotal} highlight />;
            })()}

            {/* Commission Getaround */}
            {(() => {
              const r = rental as unknown as Record<string, number | null | undefined>;
              const gaFee = r.getaroundServiceFee;
              const commission = gaFee != null && gaFee < 0
                ? Math.abs(gaFee)
                : rental.grossRevenue != null && rental.ownerPayout != null && rental.grossRevenue > rental.ownerPayout
                  ? rental.grossRevenue - rental.ownerPayout
                  : null;
              return commission != null && commission > 0.005
                ? <FinancialRow label="Commission Getaround" value={commission} negative />
                : null;
            })()}

            {/* Votre revenu */}
            <div className="my-2 border-t border-gray-200" />
            <div className="flex items-center justify-between py-2.5">
              <span className="text-sm font-semibold text-gray-500">Votre revenu</span>
              {rental.ownerPayout != null ? (
                <span className="text-sm font-bold text-green-700">
                  {rental.ownerPayout.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
                </span>
              ) : (
                <span className="text-xs italic text-gray-400">En attente de paiement</span>
              )}
            </div>
          </div>

          {/* Évaluation */}
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">Évaluation</h2>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm text-gray-500">Statut</span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  rental.evaluationStatus === 'posted'
                    ? 'bg-green-100 text-green-700'
                    : rental.evaluationStatus === 'blocked'
                    ? 'bg-red-100 text-red-700'
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                {EVAL_LABELS[rental.evaluationStatus]}
              </span>
            </div>
            {rental.evaluationRating && (
              <div className="mb-2 flex items-center gap-2">
                <Stars rating={rental.evaluationRating} />
                <span className="text-sm font-medium text-gray-700">{rental.evaluationRating}/5</span>
              </div>
            )}
            {rental.evaluationComment && (
              <p className="text-sm text-gray-600 italic">"{rental.evaluationComment}"</p>
            )}
            {rental.status === 'completed' && rental.evaluationStatus === 'pending' && (
              <button
                type="button"
                onClick={() => { if (confirm('Bloquer définitivement cette évaluation ?')) updateMutation.mutate({ evaluationStatus: 'blocked' }); }}
                disabled={updateMutation.isPending}
                className="mt-3 w-full rounded-lg border border-red-200 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
              >
                {updateMutation.isPending ? 'En cours...' : "Bloquer l'évaluation"}
              </button>
            )}
            {rental.status === 'completed' && rental.evaluationStatus === 'blocked' && (
              <button
                type="button"
                onClick={() => { if (confirm('Réactiver l\'évaluation pour ce locataire ?')) updateMutation.mutate({ evaluationStatus: 'pending' }); }}
                disabled={updateMutation.isPending}
                className="mt-3 w-full rounded-lg border border-green-200 py-1.5 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-60"
              >
                {updateMutation.isPending ? 'En cours...' : "Réactiver l'évaluation"}
              </button>
            )}
          </div>

          {/* Incidents */}
          <div className="rounded-xl border border-orange-200 bg-orange-50 p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-orange-500">
                Incidents {rental.incidents.length > 0 && `(${rental.incidents.length})`}
              </h2>
              <button type="button" onClick={() => setShowIncidentForm(s => !s)}
                className="rounded-lg bg-orange-100 px-2.5 py-1 text-xs font-medium text-orange-700 hover:bg-orange-200">
                + Signaler
              </button>
            </div>
            {showIncidentForm && (
              <form onSubmit={e => {
                e.preventDefault();
                createIncidentMutation.mutate({
                  vehicleId: rental.vehicle.id,
                  rentalId: rental.id,
                  type: incidentForm.type,
                  description: incidentForm.description,
                  ...(incidentForm.cost ? { cost: parseFloat(incidentForm.cost) } : {}),
                });
              }} className="mb-3 space-y-2 rounded-lg bg-white p-3">
                <div className="grid gap-2 grid-cols-2">
                  <select value={incidentForm.type} onChange={e => setIncidentForm(f => ({ ...f, type: e.target.value }))}
                    className="col-span-1 rounded border border-gray-200 px-2 py-1.5 text-xs outline-none focus:border-orange-400">
                    {Object.entries(INCIDENT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  <input type="number" step="0.01" value={incidentForm.cost} onChange={e => setIncidentForm(f => ({ ...f, cost: e.target.value }))}
                    className="rounded border border-gray-200 px-2 py-1.5 text-xs outline-none focus:border-orange-400" placeholder="Coût (€)" />
                </div>
                <textarea required rows={2} value={incidentForm.description} onChange={e => setIncidentForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs outline-none focus:border-orange-400 resize-none" placeholder="Description de l'incident..." />
                <div className="flex gap-2">
                  <button type="submit" disabled={createIncidentMutation.isPending}
                    className="rounded px-3 py-1.5 text-xs font-medium text-white bg-orange-500 hover:bg-orange-600 disabled:opacity-60">
                    {createIncidentMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
                  </button>
                  <button type="button" onClick={() => setShowIncidentForm(false)}
                    className="text-xs text-gray-500 hover:text-gray-700">Annuler</button>
                </div>
              </form>
            )}
            {rental.incidents.length === 0 && !showIncidentForm && (
              <p className="text-xs text-orange-400">Aucun incident signalé</p>
            )}
            {rental.incidents.map((inc) => (
              <div key={inc.id} className="mb-2 last:mb-0 rounded-lg bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-orange-800">{INCIDENT_TYPE_LABELS[inc.type] ?? inc.type}</span>
                      <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] text-orange-600">{INCIDENT_STATUS_LABELS[inc.status] ?? inc.status}</span>
                    </div>
                    <p className="text-xs text-gray-600 mt-0.5">{inc.description}</p>
                    {inc.cost != null && (
                      <p className="text-xs text-orange-500 mt-0.5 font-medium">
                        {inc.cost.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
                      </p>
                    )}
                  </div>
                  {inc.status === 'open' && (
                    <button type="button"
                      onClick={() => updateIncidentMutation.mutate({ incidentId: inc.id, status: 'in_progress' })}
                      className="shrink-0 text-[10px] text-orange-500 hover:text-orange-700 font-medium">
                      Prendre en charge
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
