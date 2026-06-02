import React, { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { vehiclesApi, vehicleCarkeepersApi, vehiclePhotosApi, vehicleRatingsApi, type VehiclePhoto, type VehicleRating } from './vehiclesApi';
import { blockingsApi, BLOCKING_TYPE_LABELS, BLOCKING_TYPE_COLORS } from './blockingsApi';
import { useAuth } from '../../hooks/useAuth';
import { api } from '../../utils/api';
import { DocumentScanner } from '../../components/ui/DocumentScanner';

interface VehicleCost {
  id: string;
  label: string;
  amount: number;
  type: string;
  createdAt: string;
}

const RATING_KEYWORDS = ['Propreté', 'Ponctualité', 'Communication', 'État du véhicule'] as const;

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-400">{title}</h2>
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-900">{value ?? '—'}</span>
    </div>
  );
}

const RESULT_LABELS: Record<string, string> = {
  pass: 'Favorable',
  advisory: 'Défavorable mineur',
  fail: 'Défavorable majeur',
};

const RESULT_COLORS: Record<string, string> = {
  pass: 'text-green-600',
  advisory: 'text-yellow-600',
  fail: 'text-red-600',
};

const BLOCKING_TYPES = ['maintenance', 'incident', 'administrative', 'other'] as const;

interface BlockingFormData {
  startAt: string;
  endAt: string;
  reason: string;
  type: typeof BLOCKING_TYPES[number];
}

const emptyForm: BlockingFormData = {
  startAt: '',
  endAt: '',
  reason: '',
  type: 'maintenance',
};

export default function VehicleDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.isSuperAdmin;

  const [activeTab, setActiveTab] = useState<'overview' | 'costs'>('overview');

  const [costLabel, setCostLabel] = useState('');
  const [costAmount, setCostAmount] = useState('');

  const { data: costs = [], refetch: refetchCosts } = useQuery<VehicleCost[]>({
    queryKey: ['vehicle-costs', id],
    queryFn: () => api.get<{ costs: VehicleCost[] }>(`/vehicles/${id}/costs`).then(r => r.data.costs),
    enabled: Boolean(id),
    staleTime: 2 * 60_000,
  });

  const addCost = useMutation({
    mutationFn: () => api.post(`/vehicles/${id}/costs`, { label: costLabel, amount: parseFloat(costAmount) }),
    onSuccess: () => { void refetchCosts(); setCostLabel(''); setCostAmount(''); },
  });

  const deleteCost = useMutation({
    mutationFn: (costId: string) => api.delete(`/vehicles/${id}/costs/${costId}`),
    onSuccess: () => { void refetchCosts(); },
  });

  const [editingCostId, setEditingCostId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editAmount, setEditAmount] = useState('');

  const updateCost = useMutation({
    mutationFn: ({ costId, label, amount }: { costId: string; label: string; amount: number }) =>
      api.put(`/vehicles/${id}/costs/${costId}`, { label, amount }),
    onSuccess: () => { void refetchCosts(); setEditingCostId(null); },
  });

  const totalMonthlyCosts = costs.reduce((s, c) => s + c.amount, 0);

  const [blockingModal, setBlockingModal] = useState(false);
  const [blockingForm, setBlockingForm] = useState<BlockingFormData>(emptyForm);
  const [editingBlockingId, setEditingBlockingId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [gpsWarning, setGpsWarning] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<VehiclePhoto | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const now = new Date();
  const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [ratingValue, setRatingValue] = useState('');
  const [ratingReviewCount, setRatingReviewCount] = useState('');
  const [ratingKeywords, setRatingKeywords] = useState<string[]>([]);
  const [ratingNotes, setRatingNotes] = useState('');

  const { data: vehicle, isLoading, isError } = useQuery({
    queryKey: ['vehicle', id],
    queryFn: () => vehiclesApi.get(id!),
    enabled: Boolean(id),
    staleTime: 5 * 60_000,
  });

  const { data: blockings = [], refetch: refetchBlockings } = useQuery({
    queryKey: ['blockings', id],
    queryFn: () => blockingsApi.list(id!),
    enabled: Boolean(id),
    staleTime: 2 * 60_000,
  });

  const { data: carkeepers = [], refetch: refetchCarkeepers } = useQuery({
    queryKey: ['vehicle-carkeepers', id],
    queryFn: () => vehicleCarkeepersApi.list(id!),
    enabled: Boolean(id) && Boolean(isAdmin),
    staleTime: 2 * 60_000,
  });

  const { data: allUsers = [] } = useQuery<Array<{ id: string; name: string; email: string; role: string }>>({
    queryKey: ['users'],
    queryFn: () => api.get<{ users: Array<{ id: string; name: string; email: string; role: string }> }>('/users').then(r => r.data.users),
    enabled: Boolean(isAdmin),
    staleTime: 5 * 60_000,
  });

  const carekeeperUsers = allUsers.filter(u => u.role === 'carkeeper');
  const assignedIds = new Set(carkeepers.map(c => c.userId));
  const unassignedCarkeepers = carekeeperUsers.filter(u => !assignedIds.has(u.id));

  const assignCarkeeper = useMutation({
    mutationFn: (userId: string) => vehicleCarkeepersApi.assign(id!, userId),
    onSuccess: () => { void refetchCarkeepers(); },
  });

  const removeCarkeeper = useMutation({
    mutationFn: (userId: string) => vehicleCarkeepersApi.remove(id!, userId),
    onSuccess: () => { void refetchCarkeepers(); },
  });

  const { data: photos = [], refetch: refetchPhotos } = useQuery<VehiclePhoto[]>({
    queryKey: ['vehicle-photos', id],
    queryFn: () => vehiclePhotosApi.list(id!),
    enabled: Boolean(id),
    staleTime: 2 * 60_000,
  });

  const { data: ratings = [], refetch: refetchRatings } = useQuery<VehicleRating[]>({
    queryKey: ['vehicle-ratings', id],
    queryFn: () => vehicleRatingsApi.list(id!),
    enabled: Boolean(id),
    staleTime: 5 * 60_000,
  });

  const upsertRating = useMutation({
    mutationFn: () => vehicleRatingsApi.upsert(id!, {
      rating: parseFloat(ratingValue),
      reviewCount: ratingReviewCount ? parseInt(ratingReviewCount, 10) : 0,
      keywords: ratingKeywords,
      ...(ratingNotes ? { notes: ratingNotes } : {}),
    }),
    onSuccess: (saved) => {
      void refetchRatings();
      setRatingValue(String(saved.rating));
      setRatingReviewCount(String(saved.reviewCount));
      setRatingKeywords(saved.keywords);
      setRatingNotes(saved.notes ?? '');
    },
  });

  const sortedPhotos = [...photos].sort((a, b) => (b.isCover ? 1 : 0) - (a.isCover ? 1 : 0));

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const files = Array.from(e.target.files ?? []);
    if (!files.length || !id) return;
    setGpsWarning(false);
    for (const file of files) {
      setUploadProgress(0);
      try {
        const { gpsWarning: warn } = await vehiclePhotosApi.upload(id, file, setUploadProgress);
        if (warn) setGpsWarning(true);
      } catch (err) { console.error('[Upload]', err); }
    }
    setUploadProgress(null);
    e.target.value = '';
    void refetchPhotos();
  }

  const deleteMutation = useMutation({
    mutationFn: () => vehiclesApi.delete(id!),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['vehicles'] });
      navigate('/vehicles');
    },
  });

  const createBlocking = useMutation({
    mutationFn: (data: BlockingFormData) => blockingsApi.create({
      vehicleId: id!,
      startAt: new Date(data.startAt).toISOString(),
      endAt: new Date(data.endAt).toISOString(),
      ...(data.reason ? { reason: data.reason } : {}),
      type: data.type,
    }),
    onSuccess: () => {
      void refetchBlockings();
      setBlockingModal(false);
      setBlockingForm(emptyForm);
      setEditingBlockingId(null);
    },
  });

  const updateBlocking = useMutation({
    mutationFn: ({ blockingId, data }: { blockingId: string; data: BlockingFormData }) =>
      blockingsApi.update(blockingId, {
        startAt: new Date(data.startAt).toISOString(),
        endAt: new Date(data.endAt).toISOString(),
        reason: data.reason || null,
        type: data.type,
      }),
    onSuccess: () => {
      void refetchBlockings();
      setBlockingModal(false);
      setBlockingForm(emptyForm);
      setEditingBlockingId(null);
    },
  });

  const deleteBlocking = useMutation({
    mutationFn: (blockingId: string) => blockingsApi.delete(blockingId),
    onSuccess: () => { void refetchBlockings(); },
  });

  function openCreateModal() {
    setEditingBlockingId(null);
    setBlockingForm(emptyForm);
    setBlockingModal(true);
  }

  function openEditModal(b: typeof blockings[number]) {
    setEditingBlockingId(b.id);
    setBlockingForm({
      startAt: b.startAt.slice(0, 16),
      endAt: b.endAt.slice(0, 16),
      reason: b.reason ?? '',
      type: b.type as typeof BLOCKING_TYPES[number],
    });
    setBlockingModal(true);
  }

  function handleBlockingSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (editingBlockingId) {
      updateBlocking.mutate({ blockingId: editingBlockingId, data: blockingForm });
    } else {
      createBlocking.mutate(blockingForm);
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" style={{ borderColor: '#01696e', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  if (isError || !vehicle) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Véhicule introuvable.
        </div>
        <Link to="/vehicles" className="mt-4 inline-block text-sm text-[#01696e] hover:underline">
          ← Retour à la flotte
        </Link>
      </div>
    );
  }

  const lastCT = vehicle.technicalControls[0];

  return (<>
    <div className="p-4 lg:p-6">
      {/* Fil d'Ariane + actions */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <Link to="/vehicles" className="text-gray-400 hover:text-gray-600">Flotte</Link>
          <span className="text-gray-300">/</span>
          <span className="font-medium text-gray-900">{vehicle.make} {vehicle.model}</span>
        </div>
        <div className="flex gap-2">
          <Link
            to={`/vehicles/${id}/edit`}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
          >
            Modifier
          </Link>
          <button
            type="button"
            onClick={() => {
              if (confirm('Désactiver ce véhicule ?')) deleteMutation.mutate();
            }}
            className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 shadow-sm hover:bg-red-50"
          >
            Désactiver
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1 w-fit">
        {(['overview', 'costs'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
              activeTab === tab ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab === 'overview' ? 'Vue générale' : 'Coûts'}
          </button>
        ))}
      </div>

      {activeTab === 'costs' && (
        <div className="space-y-4 mb-6">
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Ajouter un coût fixe</h2>
              <DocumentScanner
                type="invoice"
                label="Scanner une facture"
                onResult={(data) => {
                  if (data.label) setCostLabel(data.label as string);
                  if (data.amountMonthly) setCostAmount(String(data.amountMonthly));
                  else if (data.amount && data.period === 'annuel') setCostAmount(String(Math.round((data.amount as number) / 12 * 100) / 100));
                  else if (data.amount) setCostAmount(String(data.amount));
                }}
              />
            </div>
            <form
              onSubmit={(e) => { e.preventDefault(); if (costLabel && costAmount) addCost.mutate(); }}
              className="flex flex-wrap gap-3"
            >
              <input
                type="text"
                placeholder="Libellé (ex : Assurance)"
                value={costLabel}
                onChange={(e) => setCostLabel(e.target.value)}
                required
                className="flex-1 min-w-40 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#01696e]/30"
              />
              <input
                type="number"
                placeholder="Montant (€/mois)"
                value={costAmount}
                onChange={(e) => setCostAmount(e.target.value)}
                required
                min="0"
                step="0.01"
                className="w-40 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#01696e]/30"
              />
              <button
                type="submit"
                disabled={!costLabel || !costAmount || addCost.isPending}
                className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                style={{ backgroundColor: '#01696e' }}
              >
                Ajouter
              </button>
            </form>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Coûts fixes mensuels</h2>
              <div className="text-right">
                <p className="text-xs text-gray-400">Total mensuel</p>
                <p className="text-lg font-bold text-gray-900">{totalMonthlyCosts.toFixed(2)} €</p>
              </div>
            </div>

            {costs.length === 0 ? (
              <p className="text-sm text-gray-400">Aucun coût enregistré</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {costs.map((cost) => (
                  <div key={cost.id} className="py-3">
                    {editingCostId === cost.id ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <input type="text" value={editLabel} onChange={e => setEditLabel(e.target.value)}
                          className="flex-1 min-w-32 rounded-lg border border-[#01696e] px-3 py-1.5 text-sm focus:outline-none" />
                        <input type="number" value={editAmount} onChange={e => setEditAmount(e.target.value)}
                          min="0" step="0.01"
                          className="w-28 rounded-lg border border-[#01696e] px-3 py-1.5 text-sm focus:outline-none" />
                        <button type="button" disabled={updateCost.isPending}
                          onClick={() => updateCost.mutate({ costId: cost.id, label: editLabel, amount: parseFloat(editAmount) })}
                          className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                          style={{ backgroundColor: '#01696e' }}>OK</button>
                        <button type="button" onClick={() => setEditingCostId(null)}
                          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50">Annuler</button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{cost.label}</p>
                          <p className="text-xs text-gray-400 capitalize">{cost.type}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-gray-700">{cost.amount.toFixed(2)} €</span>
                          <button type="button" title="Modifier"
                            onClick={() => { setEditingCostId(cost.id); setEditLabel(cost.label); setEditAmount(String(cost.amount)); }}
                            className="rounded p-1 text-gray-400 hover:text-[#01696e]">
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button type="button" title="Supprimer"
                            onClick={() => { if (confirm(`Supprimer "${cost.label}" ?`)) deleteCost.mutate(cost.id); }}
                            className="rounded p-1 text-gray-400 hover:text-red-500">
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {costs.length > 0 && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-xs font-medium text-amber-700">Seuil de rentabilité mensuel</p>
                <p className="mt-0.5 text-base font-bold text-amber-800">{totalMonthlyCosts.toFixed(2)} € de revenus nécessaires pour couvrir les coûts fixes</p>
              </div>
            )}
          </div>
        </div>
      )}

      <div className={activeTab !== 'overview' ? 'hidden' : ''}>
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Colonne gauche — infos principales */}
        <div className="lg:col-span-2 space-y-4">
          {/* Photo + titre */}
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            {vehicle.photoUrl ? (
              <img
                src={vehicle.photoUrl}
                alt={`${vehicle.make} ${vehicle.model}`}
                className="h-48 w-full object-cover"
              />
            ) : (
              <div className="flex h-48 items-center justify-center bg-gray-100">
                <svg className="h-16 w-16 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
            )}
            <div className="p-5">
              <div className="flex items-center justify-between">
                <h1 className="text-xl font-bold text-gray-900">
                  {vehicle.make} {vehicle.model} {vehicle.year}
                </h1>
                <span
                  className={`rounded-full px-3 py-1 text-sm font-semibold ${
                    vehicle.healthScore >= 80 ? 'bg-green-100 text-green-700' :
                    vehicle.healthScore >= 50 ? 'bg-yellow-100 text-yellow-700' :
                    'bg-red-100 text-red-700'
                  }`}
                >
                  Score {vehicle.healthScore}/100
                </span>
              </div>
              <p className="mt-1 font-mono text-sm font-medium text-gray-500">{vehicle.licensePlate}</p>
            </div>
          </div>

          <Section title="Informations">
            <InfoRow label="Couleur" value={vehicle.color} />
            <InfoRow label="Kilométrage" value={`${vehicle.currentMileage.toLocaleString('fr-FR')} km`} />
            <InfoRow label="Statut" value={vehicle.isActive ? 'Actif' : 'Inactif'} />
            {vehicle.getaroundId && <InfoRow label="ID Getaround" value={vehicle.getaroundId} />}
            {vehicle.getaroundAccount && <InfoRow label="Compte Getaround" value={vehicle.getaroundAccount.name} />}
            {vehicle.thirdPartyOwner && <InfoRow label="Propriétaire tiers" value={vehicle.thirdPartyOwner.name} />}
          </Section>

          {/* Instructions départ / retour */}
          {(vehicle.pickupInstructions ?? vehicle.returnInstructions) && (
            <Section title="Instructions locataire">
              {vehicle.pickupInstructions && (
                <div className="mb-4">
                  <p className="mb-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Départ</p>
                  <p className="whitespace-pre-wrap rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5 text-sm text-gray-700 leading-relaxed">
                    {vehicle.pickupInstructions}
                  </p>
                </div>
              )}
              {vehicle.returnInstructions && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Retour</p>
                  <p className="whitespace-pre-wrap rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5 text-sm text-gray-700 leading-relaxed">
                    {vehicle.returnInstructions}
                  </p>
                </div>
              )}
            </Section>
          )}

          {/* Blocages */}
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Blocages</h2>
              <button
                type="button"
                onClick={openCreateModal}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white"
                style={{ backgroundColor: '#01696e' }}
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Ajouter
              </button>
            </div>
            {blockings.length === 0 ? (
              <p className="text-sm text-gray-400">Aucun blocage</p>
            ) : (
              <div className="space-y-2">
                {blockings.map((b) => (
                  <div key={b.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2.5 text-sm">
                    <div className="flex items-center gap-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BLOCKING_TYPE_COLORS[b.type]}`}>
                        {BLOCKING_TYPE_LABELS[b.type]}
                      </span>
                      <span className="text-gray-600">
                        {format(new Date(b.startAt), 'dd/MM/yy HH:mm', { locale: fr })} → {format(new Date(b.endAt), 'dd/MM/yy HH:mm', { locale: fr })}
                      </span>
                      {b.reason && <span className="text-gray-400">{b.reason}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openEditModal(b)}
                        className="rounded p-1 text-gray-400 hover:text-gray-600"
                        title="Modifier"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => { if (confirm('Supprimer ce blocage ?')) deleteBlocking.mutate(b.id); }}
                        className="rounded p-1 text-gray-400 hover:text-red-500"
                        title="Supprimer"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Derniers entretiens */}
          {vehicle.maintenances.length > 0 && (
            <Section title="Derniers entretiens">
              <div className="space-y-2">
                {vehicle.maintenances.map((m) => (
                  <div key={m.id} className="flex items-center justify-between text-sm">
                    <span className="capitalize text-gray-700">{m.type}</span>
                    <span className="text-gray-400">
                      {format(new Date(m.performedAt), 'dd/MM/yyyy', { locale: fr })}
                    </span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Photos */}
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Photos</h2>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadProgress !== null}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                style={{ backgroundColor: '#01696e' }}
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Ajouter une photo
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="hidden"
                onChange={(e) => { void handleFileChange(e); }}
              />
            </div>

            {uploadProgress !== null && (
              <div className="mb-3">
                <div className="h-1.5 w-full rounded-full bg-gray-100">
                  <div
                    className="h-1.5 rounded-full transition-all"
                    style={{ width: `${uploadProgress}%`, backgroundColor: '#01696e' }}
                  />
                </div>
                <p className="mt-1 text-xs text-gray-400 text-center">{uploadProgress}%</p>
              </div>
            )}

            {gpsWarning && (
              <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                </svg>
                Photo sans géolocalisation (GPS refusé ou indisponible)
              </div>
            )}

            {sortedPhotos.length === 0 ? (
              <p className="text-sm text-gray-400">Aucune photo</p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {sortedPhotos.map((photo) => (
                  <div key={photo.id} className="relative group">
                    <div className="aspect-[4/3] overflow-hidden rounded-lg bg-gray-100">
                      <img
                        src={photo.url}
                        alt=""
                        className="h-full w-full object-cover cursor-pointer"
                        onClick={() => setSelectedPhoto(photo)}
                      />
                    </div>
                    {photo.isCover && (
                      <span className="absolute top-1 left-1 rounded-full bg-[#01696e] px-2 py-0.5 text-[10px] font-semibold text-white">
                        Couverture
                      </span>
                    )}
                    {photo.latitude && (
                      <span className="absolute bottom-1 left-1 flex items-center gap-0.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                        <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        </svg>
                        GPS
                      </span>
                    )}
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm('Supprimer cette photo ?')) {
                            void vehiclePhotosApi.delete(id!, photo.id).then(() => refetchPhotos());
                          }
                        }}
                        className="absolute top-1 right-1 rounded-full bg-white/80 p-1 text-gray-500 opacity-0 group-hover:opacity-100 transition hover:text-red-500"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Colonne droite */}
        <div className="space-y-4">
          {/* Contrôle technique */}
          <Section title="Contrôle technique">
            {lastCT ? (
              <>
                <InfoRow
                  label="Résultat"
                  value={<span className={RESULT_COLORS[lastCT.result]}>{RESULT_LABELS[lastCT.result]}</span>}
                />
                <InfoRow
                  label="Réalisé le"
                  value={format(new Date(lastCT.performedAt), 'dd/MM/yyyy', { locale: fr })}
                />
                <InfoRow
                  label="Expire le"
                  value={format(new Date(lastCT.expiryAt), 'dd/MM/yyyy', { locale: fr })}
                />
              </>
            ) : (
              <p className="text-sm text-gray-400">Aucun contrôle enregistré</p>
            )}
          </Section>

          {/* Documents */}
          <Section title="Documents">
            {vehicle.documents.length === 0 ? (
              <p className="text-sm text-gray-400">Aucun document</p>
            ) : (
              <div className="space-y-2">
                {vehicle.documents.map((d) => (
                  <div key={d.id} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700">{d.name}</span>
                    {d.expiryDate && (
                      <span className="text-xs text-gray-400">
                        {format(new Date(d.expiryDate), 'dd/MM/yy', { locale: fr })}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Accessoires */}
          {vehicle.accessories.length > 0 && (
            <Section title="Accessoires">
              <div className="flex flex-wrap gap-2">
                {vehicle.accessories.map((a) => (
                  <span key={a.accessoryId} className="rounded-full bg-[#01696e]/10 px-3 py-1 text-xs font-medium text-[#01696e]"
                    title={a.accessory.description ?? undefined}>
                    {a.accessory.name}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {/* Note Getaround mensuelle */}
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-400">Note Getaround</h2>

            {/* Formulaire saisie */}
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Note /5</label>
                  <input
                    type="number" min="0" max="5" step="0.1"
                    placeholder="ex : 4.2"
                    value={ratingValue}
                    onChange={e => setRatingValue(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#01696e]/30"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Nombre d'avis</label>
                  <input
                    type="number" min="0" step="1"
                    placeholder="ex : 12"
                    value={ratingReviewCount}
                    onChange={e => setRatingReviewCount(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#01696e]/30"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2">Mots-clés mentionnés</label>
                <div className="flex flex-wrap gap-2">
                  {RATING_KEYWORDS.map(kw => {
                    const active = ratingKeywords.includes(kw);
                    return (
                      <button
                        key={kw} type="button"
                        onClick={() => setRatingKeywords(prev =>
                          active ? prev.filter(k => k !== kw) : [...prev, kw]
                        )}
                        className={`rounded-full px-3 py-1 text-xs font-medium border transition ${
                          active
                            ? 'border-[#01696e] bg-[#01696e]/10 text-[#01696e]'
                            : 'border-gray-200 text-gray-500 hover:border-[#01696e]/40'
                        }`}
                      >
                        {kw}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Commentaire libre</label>
                <textarea
                  rows={2}
                  value={ratingNotes}
                  onChange={e => setRatingNotes(e.target.value)}
                  placeholder="Observations..."
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#01696e]/30 resize-none"
                />
              </div>

              <button
                type="button"
                onClick={() => upsertRating.mutate()}
                disabled={!ratingValue || upsertRating.isPending}
                className="w-full rounded-lg py-2 text-sm font-semibold text-white disabled:opacity-60 transition"
                style={{ backgroundColor: '#01696e' }}
              >
                {upsertRating.isPending ? 'Enregistrement...' : `Enregistrer pour ${currentPeriod}`}
              </button>
              {upsertRating.isSuccess && (
                <p className="text-center text-xs text-green-600">Note enregistrée</p>
              )}
            </div>

            {/* Historique 6 derniers mois */}
            {ratings.length > 0 && (
              <div className="mt-5">
                <p className="mb-2 text-xs font-medium text-gray-400">Historique 6 mois</p>
                <ResponsiveContainer width="100%" height={100}>
                  <LineChart data={[...ratings].reverse().slice(0, 6)}>
                    <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                    <YAxis domain={[0, 5]} tick={{ fontSize: 10 }} width={20} />
                    <Tooltip formatter={(v: number) => [`${v}/5`, 'Note']} />
                    <Line type="monotone" dataKey="rating" stroke="#01696e" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
                <div className="mt-2 space-y-1">
                  {ratings.slice(0, 3).map(r => (
                    <div key={r.id} className="flex items-center justify-between text-xs text-gray-500">
                      <span>{r.period}</span>
                      <span className="font-medium text-gray-700">{r.rating}/5</span>
                      <span>{r.reviewCount} avis</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Carkeepers assignés — admin only */}
          {isAdmin && (
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-400">Carkeepers assignés</h2>
              {carkeepers.length === 0 ? (
                <p className="text-sm text-gray-400">Aucun carkeeper assigné</p>
              ) : (
                <div className="space-y-2 mb-3">
                  {carkeepers.map((c) => (
                    <div key={c.id} className="flex items-center justify-between text-sm">
                      <div>
                        <p className="font-medium text-gray-900">{c.user.name}</p>
                        <p className="text-xs text-gray-400">{c.user.email}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => { if (confirm(`Retirer ${c.user.name} ?`)) removeCarkeeper.mutate(c.userId); }}
                        className="rounded p-1 text-gray-400 hover:text-red-500"
                        title="Retirer"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {unassignedCarkeepers.length > 0 && (
                <select
                  defaultValue=""
                  onChange={(e) => { if (e.target.value) { assignCarkeeper.mutate(e.target.value); e.target.value = ''; } }}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#01696e]/30"
                >
                  <option value="" disabled>Assigner un carkeeper…</option>
                  {unassignedCarkeepers.map(u => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>
      </div>
      </div>{/* fin overview */}
    </div>

    {/* Modal métadonnées photo */}
    {selectedPhoto && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setSelectedPhoto(null)}>
        <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
          <img src={selectedPhoto.url} alt="" className="w-full max-h-64 object-cover" />
          <div className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Métadonnées</h3>
              <button type="button" onClick={() => setSelectedPhoto(null)} className="text-gray-400 hover:text-gray-600">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {selectedPhoto.latitude && selectedPhoto.longitude ? (
              <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 space-y-1">
                <p className="text-xs font-semibold text-blue-700">Position GPS</p>
                <p className="text-xs text-blue-600 font-mono">
                  {selectedPhoto.latitude.toFixed(6)}, {selectedPhoto.longitude.toFixed(6)}
                </p>
                {selectedPhoto.accuracy && (
                  <p className="text-xs text-blue-500">Précision : ±{Math.round(selectedPhoto.accuracy)} m</p>
                )}
                <a
                  href={`https://www.google.com/maps?q=${selectedPhoto.latitude},${selectedPhoto.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:underline"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  Voir sur Google Maps
                </a>
              </div>
            ) : (
              <p className="text-xs text-gray-400 italic">Aucune donnée GPS</p>
            )}

            <div className="divide-y divide-gray-100 text-xs">
              {selectedPhoto.takenAt && (
                <div className="flex justify-between py-2">
                  <span className="text-gray-500">Prise de vue</span>
                  <span className="font-medium text-gray-800">{format(new Date(selectedPhoto.takenAt), 'dd/MM/yyyy HH:mm', { locale: fr })}</span>
                </div>
              )}
              <div className="flex justify-between py-2">
                <span className="text-gray-500">Upload</span>
                <span className="font-medium text-gray-800">{format(new Date(selectedPhoto.uploadedAt), 'dd/MM/yyyy HH:mm', { locale: fr })}</span>
              </div>
              {selectedPhoto.deviceInfo && (
                <div className="py-2">
                  <p className="text-gray-500 mb-0.5">Appareil</p>
                  <p className="text-gray-700 break-all leading-snug" style={{ wordBreak: 'break-word' }}>
                    {selectedPhoto.deviceInfo.length > 80 ? selectedPhoto.deviceInfo.slice(0, 80) + '…' : selectedPhoto.deviceInfo}
                  </p>
                </div>
              )}
            </div>

            {isAdmin && !selectedPhoto.isCover && (
              <button
                type="button"
                onClick={async () => {
                  await vehiclePhotosApi.setCover(id!, selectedPhoto.id);
                  void refetchPhotos();
                  setSelectedPhoto(null);
                }}
                className="w-full rounded-lg py-2 text-sm font-medium text-white"
                style={{ backgroundColor: '#01696e' }}
              >
                Définir comme couverture
              </button>
            )}
          </div>
        </div>
      </div>
    )}

    {/* Modal Blocage */}
    {blockingModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
            <h3 className="font-semibold text-gray-900">
              {editingBlockingId ? 'Modifier le blocage' : 'Nouveau blocage'}
            </h3>
            <button type="button" onClick={() => setBlockingModal(false)} className="text-gray-400 hover:text-gray-600">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <form onSubmit={handleBlockingSubmit} className="p-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Début</label>
                <input
                  type="datetime-local"
                  required
                  value={blockingForm.startAt}
                  onChange={e => setBlockingForm(f => ({ ...f, startAt: e.target.value }))}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#01696e]/30"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Fin</label>
                <input
                  type="datetime-local"
                  required
                  value={blockingForm.endAt}
                  onChange={e => setBlockingForm(f => ({ ...f, endAt: e.target.value }))}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#01696e]/30"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Type</label>
              <select
                value={blockingForm.type}
                onChange={e => setBlockingForm(f => ({ ...f, type: e.target.value as typeof BLOCKING_TYPES[number] }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#01696e]/30"
              >
                {BLOCKING_TYPES.map(t => (
                  <option key={t} value={t}>{BLOCKING_TYPE_LABELS[t]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Raison (optionnel)</label>
              <input
                type="text"
                value={blockingForm.reason}
                onChange={e => setBlockingForm(f => ({ ...f, reason: e.target.value }))}
                placeholder="Ex: Vidange, Contrôle technique..."
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#01696e]/30"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setBlockingModal(false)}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={createBlocking.isPending || updateBlocking.isPending}
                className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                style={{ backgroundColor: '#01696e' }}
              >
                {editingBlockingId ? 'Enregistrer' : 'Créer'}
              </button>
            </div>
          </form>
        </div>
      </div>
    )}
  </>);
}
