import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { fr } from 'date-fns/locale';
import { api } from '../../utils/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Vehicle {
  id: string; make: string; model: string; licensePlate: string;
  year?: number; color?: string | null; healthScore?: number; isActive?: boolean; photoUrl?: string | null;
}

interface Owner {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  contractDetails: { ownerSharePercent?: number; notes?: string; startDate?: string; endDate?: string } | null;
  paymentDetails: { iban?: string; bankName?: string; paymentDay?: number; notes?: string } | null;
  user: { id: string; name: string; email: string; isActive: boolean };
  vehicles: Vehicle[];
  totalRevenue?: number;
  totalOwnerPayout?: number;
  rentalCount?: number;
}

interface StatementLine {
  rentalId: string;
  vehicle: { make: string; model: string; licensePlate: string };
  driverName: string;
  startAt: string;
  endAt: string;
  kmDriven: number | null;
  grossRevenue: number;
  ownerPayout: number;
  ownerShare: number;
  damageCompensation: number;
  lateReturnFee: number;
  gasRefillFee: number;
}

interface Statement {
  owner: { id: string; name: string; email: string; sharePercent: number };
  period: { from: string; to: string };
  vehicles: Vehicle[];
  lines: StatementLine[];
  totals: { grossRevenue: number; ownerPayout: number; ownerShare: number; rentalCount: number; totalKm: number };
}

// ─── Formulaire ──────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  name: '', email: '', phone: '',
  ownerSharePercent: 70, contractNotes: '', paymentIban: '', paymentBankName: '',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function eur(v: number) {
  return v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 });
}

function Avatar({ name }: { name: string }) {
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#01696e]/10 text-sm font-bold text-[#01696e]">
      {initials}
    </div>
  );
}

// ─── Page principale ─────────────────────────────────────────────────────────

export default function ThirdPartyOwnersPage(): React.JSX.Element {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'info' | 'vehicles' | 'statement'>('info');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [statementMonth, setStatementMonth] = useState(() => format(new Date(), 'yyyy-MM'));

  // ── Requêtes ────────────────────────────────────────────────────────────────

  const { data: ownersData, isLoading } = useQuery<{ owners: Owner[] }>({
    queryKey: ['third-party-owners'],
    queryFn: () => api.get('/third-party-owners').then(r => r.data as { owners: Owner[] }),
  });

  const { data: allVehicles = [] } = useQuery<Vehicle[]>({
    queryKey: ['vehicles-list'],
    queryFn: () => api.get<{ vehicles: Vehicle[] }>('/vehicles').then(r => r.data.vehicles),
  });

  const statementFrom = format(startOfMonth(new Date(statementMonth + '-01')), "yyyy-MM-dd'T'00:00:00'Z'");
  const statementTo = format(endOfMonth(new Date(statementMonth + '-01')), "yyyy-MM-dd'T'23:59:59'Z'");

  const { data: statement, isLoading: stmtLoading } = useQuery<Statement>({
    queryKey: ['tpo-statement', selectedId, statementMonth],
    queryFn: () => api.get(`/third-party-owners/${selectedId}/statement`, {
      params: { from: statementFrom, to: statementTo },
    }).then(r => r.data as Statement),
    enabled: Boolean(selectedId) && activeTab === 'statement',
  });

  // ── Mutations ───────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (data: typeof EMPTY_FORM) => api.post<{ owner: Owner; inviteUrl?: string }>('/third-party-owners', {
      name: data.name,
      email: data.email,
      phone: data.phone || undefined,
      contractDetails: { ownerSharePercent: data.ownerSharePercent, notes: data.contractNotes || undefined },
      paymentDetails: { iban: data.paymentIban || undefined, bankName: data.paymentBankName || undefined },
    }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['third-party-owners'] });
      if (res.data.inviteUrl) setInviteUrl(res.data.inviteUrl);
      setShowForm(false);
      setForm(EMPTY_FORM);
      setSelectedId(res.data.owner.id);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: typeof EMPTY_FORM }) =>
      api.put<{ owner: Owner }>(`/third-party-owners/${id}`, {
        name: data.name,
        email: data.email,
        phone: data.phone || null,
        contractDetails: { ownerSharePercent: data.ownerSharePercent, notes: data.contractNotes || undefined },
        paymentDetails: { iban: data.paymentIban || undefined, bankName: data.paymentBankName || undefined },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['third-party-owners'] });
      setShowForm(false);
      setEditingId(null);
    },
  });

  const assignVehiclesMutation = useMutation({
    mutationFn: ({ id, vehicleIds }: { id: string; vehicleIds: string[] }) =>
      api.put(`/third-party-owners/${id}/vehicles`, { vehicleIds }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['third-party-owners'] });
      void qc.invalidateQueries({ queryKey: ['vehicles-list'] });
    },
  });

  // ── Handlers ────────────────────────────────────────────────────────────────

  const owners = ownersData?.owners ?? [];
  const selectedOwner = owners.find(o => o.id === selectedId) ?? null;

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  }

  function openEdit(o: Owner) {
    setEditingId(o.id);
    setForm({
      name: o.name,
      email: o.email,
      phone: o.phone ?? '',
      ownerSharePercent: o.contractDetails?.ownerSharePercent ?? 70,
      contractNotes: o.contractDetails?.notes ?? '',
      paymentIban: o.paymentDetails?.iban ?? '',
      paymentBankName: o.paymentDetails?.bankName ?? '',
    });
    setShowForm(true);
  }

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: form });
    } else {
      createMutation.mutate(form);
    }
  }

  function toggleVehicle(vehicleId: string) {
    if (!selectedOwner) return;
    const current = selectedOwner.vehicles.map(v => v.id);
    const next = current.includes(vehicleId)
      ? current.filter(id => id !== vehicleId)
      : [...current, vehicleId];
    assignVehiclesMutation.mutate({ id: selectedOwner.id, vehicleIds: next });
  }

  // ── Mois disponibles pour le relevé (12 derniers mois) ───────────────────

  const monthOptions = Array.from({ length: 12 }, (_, i) => {
    const d = subMonths(new Date(), i);
    return { value: format(d, 'yyyy-MM'), label: format(d, 'MMMM yyyy', { locale: fr }) };
  });

  // ── Rendu ────────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 lg:p-6">
      {/* Titre */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Propriétaires tiers</h1>
          <p className="mt-1 text-sm text-gray-500">Gestion des véhicules et relevés de revenus</p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-white"
          style={{ backgroundColor: '#01696e' }}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Nouveau propriétaire
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Liste propriétaires */}
        <div className={selectedId ? 'lg:col-span-1' : 'lg:col-span-3'}>
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            {isLoading ? (
              <div className="flex justify-center py-12">
                <div className="h-6 w-6 animate-spin rounded-full border-4 border-t-transparent" style={{ borderColor: '#01696e', borderTopColor: 'transparent' }} />
              </div>
            ) : owners.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-sm text-gray-400">Aucun propriétaire tiers</p>
                <button type="button" onClick={openCreate} className="mt-3 text-sm text-[#01696e] hover:underline">
                  Ajouter le premier
                </button>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {owners.map(o => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => { setSelectedId(s => s === o.id ? null : o.id); setActiveTab('info'); }}
                    className={`w-full px-4 py-4 text-left hover:bg-gray-50 transition-colors ${
                      selectedId === o.id ? 'bg-[#01696e]/5 border-l-2 border-[#01696e]' : ''
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Avatar name={o.name} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-semibold text-gray-900 truncate">{o.name}</p>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            o.user.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
                          }`}>
                            {o.user.isActive ? 'Actif' : 'Inactif'}
                          </span>
                        </div>
                        <p className="text-xs text-gray-400 truncate">{o.email}</p>
                        <div className="mt-1.5 flex items-center gap-3 text-xs text-gray-400">
                          <span>{o.vehicles.length} véhicule{o.vehicles.length > 1 ? 's' : ''}</span>
                          {o.rentalCount !== undefined && <span>{o.rentalCount} locations</span>}
                          {o.totalOwnerPayout !== undefined && o.totalOwnerPayout > 0 && (
                            <span className="font-medium text-gray-600">{eur(o.totalOwnerPayout)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Panneau détail */}
        {selectedOwner && (
          <div className="lg:col-span-2">
            <div className="rounded-xl border border-gray-200 bg-white">
              {/* En-tête du panneau */}
              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
                <div className="flex items-center gap-3">
                  <Avatar name={selectedOwner.name} />
                  <div>
                    <h2 className="font-bold text-gray-900">{selectedOwner.name}</h2>
                    <p className="text-sm text-gray-400">{selectedOwner.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openEdit(selectedOwner)}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
                  >
                    Modifier
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedId(null)}
                    className="rounded-lg p-1.5 text-gray-400 hover:text-gray-600"
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Onglets */}
              <div className="flex border-b border-gray-100">
                {(['info', 'vehicles', 'statement'] as const).map(tab => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    className={`px-5 py-3 text-sm font-medium transition-colors ${
                      activeTab === tab
                        ? 'border-b-2 border-[#01696e] text-[#01696e]'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {tab === 'info' ? 'Informations' : tab === 'vehicles' ? 'Véhicules' : 'Relevé de revenus'}
                  </button>
                ))}
              </div>

              {/* Onglet Informations */}
              {activeTab === 'info' && (
                <div className="p-5 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="rounded-lg bg-gray-50 p-4">
                      <p className="text-xs text-gray-400 mb-1">Téléphone</p>
                      <p className="text-sm font-medium text-gray-900">{selectedOwner.phone ?? '—'}</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-4">
                      <p className="text-xs text-gray-400 mb-1">Accès plateforme</p>
                      <p className={`text-sm font-medium ${selectedOwner.user.isActive ? 'text-emerald-600' : 'text-gray-400'}`}>
                        {selectedOwner.user.isActive ? 'Actif' : 'En attente d\'activation'}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-lg border border-gray-100 p-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Contrat</h3>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Part propriétaire</span>
                        <span className="font-semibold text-gray-900">
                          {selectedOwner.contractDetails?.ownerSharePercent ?? 70}% du virement Getaround
                        </span>
                      </div>
                      {selectedOwner.contractDetails?.startDate && (
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-500">Début contrat</span>
                          <span className="text-gray-700">{format(new Date(selectedOwner.contractDetails.startDate), 'dd/MM/yyyy', { locale: fr })}</span>
                        </div>
                      )}
                      {selectedOwner.contractDetails?.notes && (
                        <p className="text-sm text-gray-500 italic mt-2">{selectedOwner.contractDetails.notes}</p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-lg border border-gray-100 p-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Paiement</h3>
                    <div className="space-y-2">
                      {selectedOwner.paymentDetails?.iban ? (
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-500">IBAN</span>
                          <span className="font-mono text-gray-700">{selectedOwner.paymentDetails.iban}</span>
                        </div>
                      ) : (
                        <p className="text-sm text-gray-400">Aucun IBAN renseigné</p>
                      )}
                      {selectedOwner.paymentDetails?.bankName && (
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-500">Banque</span>
                          <span className="text-gray-700">{selectedOwner.paymentDetails.bankName}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Statistiques globales */}
                  {(selectedOwner.rentalCount ?? 0) > 0 && (
                    <div className="grid grid-cols-3 gap-3">
                      <div className="rounded-lg bg-[#01696e]/5 p-3 text-center">
                        <p className="text-xl font-bold text-[#01696e]">{selectedOwner.vehicles.length}</p>
                        <p className="text-xs text-gray-500">Véhicules</p>
                      </div>
                      <div className="rounded-lg bg-[#01696e]/5 p-3 text-center">
                        <p className="text-xl font-bold text-[#01696e]">{selectedOwner.rentalCount}</p>
                        <p className="text-xs text-gray-500">Locations</p>
                      </div>
                      <div className="rounded-lg bg-[#01696e]/5 p-3 text-center">
                        <p className="text-sm font-bold text-[#01696e]">{selectedOwner.totalOwnerPayout != null ? eur(selectedOwner.totalOwnerPayout) : '—'}</p>
                        <p className="text-xs text-gray-500">Gains totaux</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Onglet Véhicules */}
              {activeTab === 'vehicles' && (
                <div className="p-5">
                  <p className="mb-3 text-sm text-gray-500">Cochez les véhicules appartenant à ce propriétaire.</p>
                  {allVehicles.length === 0 ? (
                    <p className="text-sm text-gray-400">Aucun véhicule dans la flotte</p>
                  ) : (
                    <div className="space-y-2">
                      {allVehicles.map(v => {
                        const isAssigned = selectedOwner.vehicles.some(sv => sv.id === v.id);
                        return (
                          <label
                            key={v.id}
                            className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition-colors ${
                              isAssigned ? 'border-[#01696e]/30 bg-[#01696e]/5' : 'border-gray-100 hover:bg-gray-50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isAssigned}
                              onChange={() => toggleVehicle(v.id)}
                              className="h-4 w-4 rounded border-gray-300 text-[#01696e]"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900">{v.make} {v.model}</p>
                              <p className="font-mono text-xs text-gray-400">{v.licensePlate}</p>
                            </div>
                            {isAssigned && (
                              <span className="text-xs text-[#01696e] font-medium">Assigné</span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Onglet Relevé de revenus */}
              {activeTab === 'statement' && (
                <div className="p-5">
                  {/* Sélecteur de mois */}
                  <div className="mb-4 flex items-center gap-3">
                    <select
                      value={statementMonth}
                      onChange={e => setStatementMonth(e.target.value)}
                      className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#01696e]/30"
                    >
                      {monthOptions.map(m => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                  </div>

                  {stmtLoading ? (
                    <div className="flex justify-center py-10">
                      <div className="h-6 w-6 animate-spin rounded-full border-4 border-t-transparent" style={{ borderColor: '#01696e', borderTopColor: 'transparent' }} />
                    </div>
                  ) : !statement || statement.lines.length === 0 ? (
                    <p className="py-8 text-center text-sm text-gray-400">Aucune location sur cette période</p>
                  ) : (
                    <>
                      {/* Totaux */}
                      <div className="mb-4 grid grid-cols-3 gap-3">
                        <div className="rounded-lg bg-gray-50 p-3 text-center">
                          <p className="text-lg font-bold text-gray-900">{statement.totals.rentalCount}</p>
                          <p className="text-xs text-gray-400">Locations</p>
                        </div>
                        <div className="rounded-lg bg-gray-50 p-3 text-center">
                          <p className="text-sm font-bold text-gray-700">{eur(statement.totals.ownerPayout)}</p>
                          <p className="text-xs text-gray-400">Virement Getaround</p>
                        </div>
                        <div className="rounded-lg bg-[#01696e]/5 p-3 text-center">
                          <p className="text-sm font-bold text-[#01696e]">{eur(statement.totals.ownerShare)}</p>
                          <p className="text-xs text-gray-400">Part propriétaire ({statement.owner.sharePercent}%)</p>
                        </div>
                      </div>

                      {/* Lignes de relevé */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-gray-100 text-left text-gray-400">
                              <th className="pb-2 pr-3 font-medium">Véhicule</th>
                              <th className="pb-2 pr-3 font-medium">Conducteur</th>
                              <th className="pb-2 pr-3 font-medium">Période</th>
                              <th className="pb-2 pr-3 font-medium text-right">CA brut</th>
                              <th className="pb-2 pr-3 font-medium text-right">Virement</th>
                              <th className="pb-2 font-medium text-right">Part proprio</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {statement.lines.map(l => (
                              <tr key={l.rentalId} className="text-gray-700">
                                <td className="py-2 pr-3">
                                  <p className="font-medium">{l.vehicle.make} {l.vehicle.model}</p>
                                  <p className="font-mono text-gray-400">{l.vehicle.licensePlate}</p>
                                </td>
                                <td className="py-2 pr-3 truncate max-w-[120px]">{l.driverName}</td>
                                <td className="py-2 pr-3 whitespace-nowrap">
                                  {format(new Date(l.startAt), 'dd/MM', { locale: fr })} → {format(new Date(l.endAt), 'dd/MM', { locale: fr })}
                                </td>
                                <td className="py-2 pr-3 text-right">{eur(l.grossRevenue)}</td>
                                <td className="py-2 pr-3 text-right">{eur(l.ownerPayout)}</td>
                                <td className="py-2 text-right font-semibold text-[#01696e]">{eur(l.ownerShare)}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="border-t-2 border-gray-200 font-semibold">
                              <td colSpan={3} className="pt-2 text-gray-600">Total</td>
                              <td className="pt-2 pr-3 text-right">{eur(statement.totals.grossRevenue)}</td>
                              <td className="pt-2 pr-3 text-right">{eur(statement.totals.ownerPayout)}</td>
                              <td className="pt-2 text-right text-[#01696e]">{eur(statement.totals.ownerShare)}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modal création / édition */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <h3 className="font-semibold text-gray-900">
                {editingId ? 'Modifier le propriétaire' : 'Nouveau propriétaire tiers'}
              </h3>
              <button type="button" onClick={() => { setShowForm(false); setEditingId(null); }}
                className="text-gray-400 hover:text-gray-600">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleFormSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
              {/* Identité */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Nom *</label>
                  <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#01696e]/30" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Email *</label>
                  <input required type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#01696e]/30" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Téléphone</label>
                <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#01696e]/30" />
              </div>

              {/* Contrat */}
              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Contrat</p>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Part propriétaire (% du virement Getaround)
                  </label>
                  <div className="flex items-center gap-3">
                    <input type="range" min={0} max={100} step={5}
                      value={form.ownerSharePercent}
                      onChange={e => setForm(f => ({ ...f, ownerSharePercent: Number(e.target.value) }))}
                      className="flex-1" />
                    <span className="w-12 text-center font-bold text-[#01696e]">{form.ownerSharePercent}%</span>
                  </div>
                </div>
                <div className="mt-3">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Notes contrat</label>
                  <textarea rows={2} value={form.contractNotes} onChange={e => setForm(f => ({ ...f, contractNotes: e.target.value }))}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#01696e]/30" />
                </div>
              </div>

              {/* Paiement */}
              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Paiement</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">IBAN</label>
                    <input value={form.paymentIban} onChange={e => setForm(f => ({ ...f, paymentIban: e.target.value }))}
                      placeholder="FR76..." className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#01696e]/30" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Banque</label>
                    <input value={form.paymentBankName} onChange={e => setForm(f => ({ ...f, paymentBankName: e.target.value }))}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#01696e]/30" />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => { setShowForm(false); setEditingId(null); }}
                  className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                  Annuler
                </button>
                <button type="submit" disabled={createMutation.isPending || updateMutation.isPending}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                  style={{ backgroundColor: '#01696e' }}>
                  {editingId ? 'Enregistrer' : 'Créer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal lien d'invitation */}
      {inviteUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100">
                <svg className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Propriétaire créé</h3>
                <p className="text-sm text-gray-500">Lien d'invitation valable 30 jours</p>
              </div>
            </div>
            <div className="mb-4 rounded-lg bg-gray-50 p-3">
              <p className="break-all font-mono text-xs text-gray-600">{inviteUrl}</p>
            </div>
            <div className="flex gap-3">
              <button type="button"
                onClick={() => { void navigator.clipboard.writeText(inviteUrl); }}
                className="flex-1 rounded-lg border border-gray-200 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                Copier
              </button>
              <button type="button" onClick={() => setInviteUrl(null)}
                className="flex-1 rounded-lg py-2 text-sm font-medium text-white"
                style={{ backgroundColor: '#01696e' }}>
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
