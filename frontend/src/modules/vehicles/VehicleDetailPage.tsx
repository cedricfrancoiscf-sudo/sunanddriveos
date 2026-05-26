import React, { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { vehiclesApi, vehicleCarkeepersApi } from './vehiclesApi';
import { blockingsApi, BLOCKING_TYPE_LABELS, BLOCKING_TYPE_COLORS } from './blockingsApi';
import { useAuth } from '../../hooks/useAuth';
import { api } from '../../utils/api';

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

  const [blockingModal, setBlockingModal] = useState(false);
  const [blockingForm, setBlockingForm] = useState<BlockingFormData>(emptyForm);
  const [editingBlockingId, setEditingBlockingId] = useState<string | null>(null);

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
    </div>

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
