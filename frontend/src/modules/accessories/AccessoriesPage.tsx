import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../utils/api';

// ── Types ──────────────────────────────────────────────────────────────────

interface Vehicle { id: string; make: string; model: string; licensePlate: string; parkingZone?: string; }
interface Rental { id: string; driverName: string; startAt: string; endAt: string; vehicle: Vehicle; }
interface AccessoryVehicleRow { vehicleId: string; accessoryId: string; vehicle: Vehicle; }
interface Accessory {
  id: string; name: string; description: string | null; quantity: number;
  carkeeperId: string | null;
  vehicles: AccessoryVehicleRow[];
}
interface AccReservation {
  id: string; status: string; notes?: string; createdAt: string;
  accessory: { id: string; name: string; };
  rental: Rental;
}
interface CarSeat {
  id: string; name: string; minWeightKg: number; maxWeightKg: number;
  totalStock: number; availableStock: number; outOfService: number; isActive: boolean;
  carkeeperId: string | null;
}
interface CarkeeperUser { id: string; name: string; role: string; roles: string[]; }
type Tab = 'accessories' | 'car-seats';

// ── Utilitaires ───────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  pending:   { label: 'En attente', cls: 'bg-yellow-50 text-yellow-700' },
  confirmed: { label: 'Confirmée',  cls: 'bg-green-50 text-green-700' },
  returned:  { label: 'Retourné',   cls: 'bg-gray-100 text-gray-500' },
  cancelled: { label: 'Annulée',    cls: 'bg-red-50 text-red-400' },
};

function StatusBadge({ status }: { status: string }): React.JSX.Element {
  const s = STATUS_LABEL[status] ?? { label: status, cls: 'bg-gray-100 text-gray-500' };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>;
}

// ── Accessories tab ────────────────────────────────────────────────────────

const EMPTY_ACC = { name: '', description: '', quantity: 1 };

function AccessoriesTab(): React.JSX.Element {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_ACC);
  const [editId, setEditId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [assignVehicleId, setAssignVehicleId] = useState('');
  const [reserveRentalId, setReserveRentalId] = useState<Record<string, string>>({});

  const CAR_SEAT_PATTERN = /si[eè]ge|child.?seat|baby.?seat|car.?seat/i;
  function isCarSeatAccessory(name: string): boolean { return CAR_SEAT_PATTERN.test(name); }

  const { data: rawAccessories = [], isLoading } = useQuery({
    queryKey: ['accessories'],
    queryFn: () => api.get<{ accessories: Accessory[] }>('/accessories').then(r => r.data.accessories),
    staleTime: 2 * 60_000,
  });
  const accessories = [...rawAccessories].sort((a, b) => {
    const aS = isCarSeatAccessory(a.name) ? 0 : 1;
    const bS = isCarSeatAccessory(b.name) ? 0 : 1;
    if (aS !== bS) return aS - bS;
    return a.name.localeCompare(b.name, 'fr');
  });

  const { data: vehiclesData = [] } = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => api.get<{ vehicles: Vehicle[] }>('/vehicles').then(r => r.data.vehicles),
    staleTime: 5 * 60_000,
  });

  const { data: allUsers = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<{ users: CarkeeperUser[] }>('/users').then(r => r.data.users),
    staleTime: 5 * 60_000,
  });
  const carkeepers = allUsers.filter(u => u.roles?.includes('carkeeper') || u.role === 'carkeeper');

  const { data: rentalsData = [] } = useQuery({
    queryKey: ['rentals-active'],
    queryFn: () => api.get<{ rentals: Rental[] }>('/rentals?status=booked&limit=100').then(r => r.data.rentals),
    staleTime: 30_000,
  });

  const { data: allReservations = [] } = useQuery({
    queryKey: ['acc-reservations'],
    queryFn: () => api.get<{ reservations: AccReservation[] }>('/accessory-reservations').then(r => r.data.reservations),
    staleTime: 2 * 60_000,
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof EMPTY_ACC) => api.post('/accessories', { ...data, quantity: Number(data.quantity) }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['accessories'] }); setShowForm(false); setForm(EMPTY_ACC); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: string } & typeof EMPTY_ACC) =>
      api.put(`/accessories/${id}`, { ...data, quantity: Number(data.quantity) }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['accessories'] }); setEditId(null); setForm(EMPTY_ACC); setShowForm(false); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/accessories/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['accessories'] }),
  });

  const assignMutation = useMutation({
    mutationFn: ({ id, vehicleId }: { id: string; vehicleId: string }) =>
      api.post(`/accessories/${id}/assign`, { vehicleId }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['accessories'] }); setAssignVehicleId(''); },
  });

  const unassignMutation = useMutation({
    mutationFn: ({ id, vehicleId }: { id: string; vehicleId: string }) =>
      api.delete(`/accessories/${id}/vehicles/${vehicleId}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['accessories'] }),
  });

  const reserveMutation = useMutation({
    mutationFn: ({ accessoryId, rentalId }: { accessoryId: string; rentalId: string }) =>
      api.post('/accessory-reservations', { accessoryId, rentalId }),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['acc-reservations'] });
      setReserveRentalId(prev => { const n = { ...prev }; delete n[vars.accessoryId]; return n; });
    },
  });

  const confirmResMutation = useMutation({
    mutationFn: (id: string) => api.put(`/accessory-reservations/${id}/confirm`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['acc-reservations'] }),
  });

  const returnResMutation = useMutation({
    mutationFn: (id: string) => api.put(`/accessory-reservations/${id}/return`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['acc-reservations'] }),
  });

  const cancelResMutation = useMutation({
    mutationFn: (id: string) => api.put(`/accessory-reservations/${id}/cancel`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['acc-reservations'] }),
  });

  const setCarekeeperMutation = useMutation({
    mutationFn: ({ id, carkeeperId }: { id: string; carkeeperId: string | null }) =>
      api.put(`/accessories/${id}`, { carkeeperId }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['accessories'] }),
  });

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (editId) updateMutation.mutate({ id: editId, ...form });
    else createMutation.mutate(form);
  }

  function startEdit(a: Accessory): void {
    setEditId(a.id);
    setForm({ name: a.name, description: a.description ?? '', quantity: a.quantity });
    setShowForm(true);
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-gray-500">{accessories.length} accessoire{accessories.length !== 1 ? 's' : ''}</p>
        <button type="button" onClick={() => { setShowForm(true); setEditId(null); setForm(EMPTY_ACC); }}
          className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white" style={{ backgroundColor: '#01696e' }}>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Ajouter
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="mb-5 rounded-2xl border border-[#01696e]/20 bg-[#01696e]/5 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-900">{editId ? 'Modifier' : 'Nouvel accessoire'}</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-gray-600">Nom *</label>
              <input required type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#01696e]"
                placeholder="GPS, Chaînes neige, Câble recharge..." />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Quantité</label>
              <input type="number" min="1" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: Number(e.target.value) }))}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
            </div>
            <div className="sm:col-span-3">
              <label className="mb-1 block text-xs font-medium text-gray-600">Description</label>
              <input type="text" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#01696e]"
                placeholder="Informations complémentaires..." />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={isPending}
              className="rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" style={{ backgroundColor: '#01696e' }}>
              {isPending ? 'Enregistrement...' : editId ? 'Modifier' : 'Créer'}
            </button>
            <button type="button" onClick={() => { setShowForm(false); setEditId(null); }}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Annuler</button>
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" style={{ borderColor: '#01696e', borderTopColor: 'transparent' }} />
        </div>
      ) : accessories.length === 0 ? (
        <div className="py-16 text-center text-gray-400">Aucun accessoire enregistré</div>
      ) : (
        <div className="space-y-2">
          {accessories.map(a => {
            const isExpanded = expandedId === a.id;
            const assignedIds = new Set(a.vehicles.map(v => v.vehicleId));
            const availableVehicles = vehiclesData.filter(v => !assignedIds.has(v.id));
            const myReservations = allReservations.filter(
              r => r.accessory.id === a.id && r.status !== 'cancelled' && r.status !== 'returned'
            );
            const activeResCount = myReservations.filter(r => r.status === 'confirmed').length;

            return (
              <div key={a.id} className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                <div className="flex items-center gap-4 px-4 py-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#01696e]/10">
                    <svg className="h-5 w-5 text-[#01696e]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-900">{a.name}</span>
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">×{a.quantity}</span>
                      {activeResCount > 0 && (
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-600">
                          {activeResCount} résa active{activeResCount > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    {a.description && <p className="text-xs text-gray-400 truncate">{a.description}</p>}
                    {a.vehicles.length === 0 ? (
                      <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-600">Compatible avec tous les véhicules</span>
                    ) : (
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-600">{a.vehicles.length} véhicule{a.vehicles.length !== 1 ? 's' : ''} compatible{a.vehicles.length !== 1 ? 's' : ''}</span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" onClick={() => setExpandedId(isExpanded ? null : a.id)}
                      className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
                      {isExpanded ? 'Fermer' : 'Gérer'}
                    </button>
                    <button type="button" onClick={() => startEdit(a)} className="p-1.5 text-gray-400 hover:text-[#01696e]">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                    </button>
                    <button type="button" onClick={() => { if (confirm('Supprimer ?')) deleteMutation.mutate(a.id); }}
                      className="p-1.5 text-gray-300 hover:text-red-500">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-gray-100 bg-gray-50 px-4 py-3 space-y-4">

                    {/* Carkeeper responsable */}
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Carkeeper responsable</p>
                      <select
                        value={a.carkeeperId ?? ''}
                        onChange={e => setCarekeeperMutation.mutate({ id: a.id, carkeeperId: e.target.value || null })}
                        disabled={setCarekeeperMutation.isPending}
                        className="w-full max-w-xs rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#01696e] disabled:opacity-50"
                      >
                        <option value="">Aucun</option>
                        {carkeepers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                    </div>

                    {/* Véhicules assignés */}
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Véhicules assignés</p>
                      {a.vehicles.length === 0 && <p className="text-xs text-gray-400">Aucun</p>}
                      {a.vehicles.map(av => (
                        <div key={av.vehicleId} className="flex items-center justify-between rounded-lg bg-white border border-gray-200 px-3 py-2">
                          <span className="text-sm text-gray-800">{av.vehicle.make} {av.vehicle.model}
                            <span className="ml-2 text-xs text-gray-400 tracking-wide">{av.vehicle.licensePlate}</span>
                          </span>
                          <button type="button" onClick={() => unassignMutation.mutate({ id: a.id, vehicleId: av.vehicleId })}
                            className="text-xs text-red-400 hover:text-red-600 font-medium">Retirer</button>
                        </div>
                      ))}
                      {availableVehicles.length > 0 && (
                        <div className="flex items-center gap-2">
                          <select value={assignVehicleId} onChange={e => setAssignVehicleId(e.target.value)}
                            className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#01696e]">
                            <option value="">Assigner à un véhicule...</option>
                            {availableVehicles.map(v => <option key={v.id} value={v.id}>{v.make} {v.model} — {v.licensePlate}</option>)}
                          </select>
                          <button type="button" disabled={!assignVehicleId}
                            onClick={() => assignMutation.mutate({ id: a.id, vehicleId: assignVehicleId })}
                            className="rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-40" style={{ backgroundColor: '#01696e' }}>
                            Assigner
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Réservations */}
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Réservations</p>

                      {myReservations.length === 0 && <p className="text-xs text-gray-400">Aucune réservation active</p>}

                      {myReservations.map(res => (
                        <div key={res.id} className="rounded-lg bg-white border border-gray-200 px-3 py-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium text-gray-800">{res.rental.driverName}</span>
                                <StatusBadge status={res.status} />
                              </div>
                              <p className="text-xs text-gray-500">
                                {res.rental.vehicle.make} {res.rental.vehicle.model}
                                <span className="ml-1 tracking-wide">{res.rental.vehicle.licensePlate}</span>
                                {res.rental.vehicle.parkingZone && <span className="ml-2 text-gray-400">· {res.rental.vehicle.parkingZone}</span>}
                              </p>
                              <p className="text-xs text-gray-400">
                                {fmtDate(res.rental.startAt)} → {fmtDate(res.rental.endAt)}
                              </p>
                            </div>
                            <div className="flex shrink-0 gap-1">
                              {res.status === 'pending' && (
                                <>
                                  <button type="button" onClick={() => confirmResMutation.mutate(res.id)}
                                    disabled={confirmResMutation.isPending}
                                    className="rounded-lg border border-green-200 px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-40">
                                    Confirmer
                                  </button>
                                  <button type="button" onClick={() => cancelResMutation.mutate(res.id)}
                                    disabled={cancelResMutation.isPending}
                                    className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-40">
                                    Annuler
                                  </button>
                                </>
                              )}
                              {res.status === 'confirmed' && (
                                <button type="button" onClick={() => returnResMutation.mutate(res.id)}
                                  disabled={returnResMutation.isPending}
                                  className="rounded-lg border border-[#01696e]/30 px-2 py-1 text-xs font-medium text-[#01696e] hover:bg-[#01696e]/5 disabled:opacity-40">
                                  Retour
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}

                      {/* Nouvelle réservation */}
                      {rentalsData.length > 0 && (
                        <div className="flex items-center gap-2">
                          <select
                            value={reserveRentalId[a.id] ?? ''}
                            onChange={e => setReserveRentalId(prev => ({ ...prev, [a.id]: e.target.value }))}
                            className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#01696e]">
                            <option value="">Réserver pour une location...</option>
                            {rentalsData.map(r => (
                              <option key={r.id} value={r.id}>
                                {r.driverName} — {r.vehicle.make} {r.vehicle.model} ({fmtDate(r.startAt)})
                              </option>
                            ))}
                          </select>
                          <button type="button"
                            disabled={!reserveRentalId[a.id] || reserveMutation.isPending}
                            onClick={() => reserveMutation.mutate({ accessoryId: a.id, rentalId: reserveRentalId[a.id]! })}
                            className="rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
                            style={{ backgroundColor: '#01696e' }}>
                            Réserver
                          </button>
                        </div>
                      )}
                    </div>

                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Car Seats tab ──────────────────────────────────────────────────────────

const EMPTY_SEAT = { name: '', minWeightKg: '', maxWeightKg: '', totalStock: '1', carkeeperId: '' };

function CarSeatsTab(): React.JSX.Element {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_SEAT);
  const [editId, setEditId] = useState<string | null>(null);

  const { data: seats = [], isLoading } = useQuery({
    queryKey: ['car-seats'],
    queryFn: () => api.get<{ seats: CarSeat[] }>('/car-seats').then(r => r.data.seats),
  });

  const { data: seatUsers = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<{ users: CarkeeperUser[] }>('/users').then(r => r.data.users),
    staleTime: 5 * 60_000,
  });
  const seatCarkeepers = seatUsers.filter(u => u.roles?.includes('carkeeper') || u.role === 'carkeeper');

  const outOfStockCount = seats.filter(s => s.availableStock === 0).length;

  const createMutation = useMutation({
    mutationFn: (data: typeof EMPTY_SEAT) => api.post('/car-seats', {
      name: data.name,
      minWeightKg: Number(data.minWeightKg),
      maxWeightKg: Number(data.maxWeightKg),
      totalStock: Number(data.totalStock),
    }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['car-seats'] }); setShowForm(false); setForm(EMPTY_SEAT); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: string } & typeof EMPTY_SEAT) => api.put(`/car-seats/${id}`, {
      name: data.name,
      minWeightKg: Number(data.minWeightKg),
      maxWeightKg: Number(data.maxWeightKg),
      carkeeperId: data.carkeeperId || null,
    }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['car-seats'] }); setEditId(null); setForm(EMPTY_SEAT); setShowForm(false); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/car-seats/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['car-seats'] }),
  });

  const outOfServiceMutation = useMutation({
    mutationFn: (id: string) => api.post(`/car-seats/${id}/out-of-service`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['car-seats'] }),
  });

  const inServiceMutation = useMutation({
    mutationFn: (id: string) => api.post(`/car-seats/${id}/in-service`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['car-seats'] }),
  });

  const addStockMutation = useMutation({
    mutationFn: (id: string) => api.post(`/car-seats/${id}/add-stock`, { count: 1 }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['car-seats'] }),
  });

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (editId) updateMutation.mutate({ id: editId, ...form });
    else createMutation.mutate(form);
  }

  function startEdit(s: CarSeat): void {
    setEditId(s.id);
    setForm({ name: s.name, minWeightKg: String(s.minWeightKg), maxWeightKg: String(s.maxWeightKg), totalStock: String(s.totalStock), carkeeperId: s.carkeeperId ?? '' });
    setShowForm(true);
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <p className="text-sm text-gray-500">{seats.length} type{seats.length !== 1 ? 's' : ''}</p>
          {outOfStockCount > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-600">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500" />
              {outOfStockCount} rupture{outOfStockCount > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <button type="button" onClick={() => { setShowForm(true); setEditId(null); setForm(EMPTY_SEAT); }}
          className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white" style={{ backgroundColor: '#01696e' }}>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Ajouter
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="mb-5 rounded-2xl border border-[#01696e]/20 bg-[#01696e]/5 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-900">{editId ? 'Modifier' : 'Nouveau type de siège'}</h2>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-gray-600">Nom *</label>
              <input required type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#01696e]"
                placeholder="Groupe 0+ (0-13 kg)" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Poids min (kg) *</label>
              <input required type="number" step="0.1" min="0" value={form.minWeightKg}
                onChange={e => setForm(f => ({ ...f, minWeightKg: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Poids max (kg) *</label>
              <input required type="number" step="0.1" min="0" value={form.maxWeightKg}
                onChange={e => setForm(f => ({ ...f, maxWeightKg: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
            </div>
            {!editId && (
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Stock initial</label>
                <input type="number" min="0" value={form.totalStock}
                  onChange={e => setForm(f => ({ ...f, totalStock: e.target.value }))}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
              </div>
            )}
            <div className="sm:col-span-4">
              <label className="mb-1 block text-xs font-medium text-gray-600">Carkeeper responsable</label>
              <select value={form.carkeeperId} onChange={e => setForm(f => ({ ...f, carkeeperId: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#01696e]">
                <option value="">Aucun</option>
                {seatCarkeepers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={isPending}
              className="rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" style={{ backgroundColor: '#01696e' }}>
              {isPending ? 'Enregistrement...' : editId ? 'Modifier' : 'Créer'}
            </button>
            <button type="button" onClick={() => { setShowForm(false); setEditId(null); }}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Annuler</button>
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" style={{ borderColor: '#01696e', borderTopColor: 'transparent' }} />
        </div>
      ) : seats.length === 0 ? (
        <div className="py-16 text-center text-gray-400">Aucun siège auto configuré</div>
      ) : (
        <div className="space-y-2">
          {seats.map(s => {
            const isOutOfStock = s.availableStock === 0;
            return (
              <div key={s.id} className={`rounded-xl border bg-white shadow-sm ${isOutOfStock ? 'border-red-200' : 'border-gray-200'}`}>
                <div className="flex items-center gap-4 px-4 py-3">
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${isOutOfStock ? 'bg-red-50' : 'bg-[#01696e]/10'}`}>
                    <svg className={`h-5 w-5 ${isOutOfStock ? 'text-red-400' : 'text-[#01696e]'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M5 10V7a7 7 0 0114 0v3M5 10h14M5 10l-1 9h16l-1-9M9 10v4m6-4v4" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-900">{s.name}</span>
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">{s.minWeightKg}–{s.maxWeightKg} kg</span>
                      {isOutOfStock && (
                        <span className="flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-600">
                          <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500" />
                          Rupture
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 flex items-center gap-3">
                      <StockBar seat={s} />
                      <span data-testid="stock-disponible" className="shrink-0 text-xs text-gray-500">
                        {s.availableStock} dispo / {s.totalStock}
                        {s.outOfService > 0 && <span className="ml-1 text-orange-500">· {s.outOfService} HS</span>}
                      </span>
                    </div>
                    {s.carkeeperId && (() => {
                      const ck = seatCarkeepers.find(u => u.id === s.carkeeperId);
                      return ck ? <p className="mt-0.5 text-xs text-blue-600">Carkeeper : {ck.name}</p> : null;
                    })()}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" title="+1 stock" onClick={() => addStockMutation.mutate(s.id)}
                      disabled={addStockMutation.isPending}
                      className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40">+1</button>
                    {s.availableStock > 0 && (
                      <button type="button"
                        onClick={() => { if (confirm('Mettre 1 unité hors service ?')) outOfServiceMutation.mutate(s.id); }}
                        disabled={outOfServiceMutation.isPending}
                        className="rounded-lg border border-orange-200 px-2 py-1.5 text-xs font-medium text-orange-600 hover:bg-orange-50 disabled:opacity-40">HS</button>
                    )}
                    {s.outOfService > 0 && (
                      <button type="button" onClick={() => inServiceMutation.mutate(s.id)}
                        disabled={inServiceMutation.isPending}
                        className="rounded-lg border border-green-200 px-2 py-1.5 text-xs font-medium text-green-600 hover:bg-green-50 disabled:opacity-40">
                        Remise en service
                      </button>
                    )}
                    <button type="button" data-testid="btn-modifier-siege" onClick={() => startEdit(s)} className="p-1.5 text-gray-400 hover:text-[#01696e]">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                    </button>
                    <button type="button"
                      onClick={() => { if (confirm('Supprimer ce siège ?')) deleteMutation.mutate(s.id); }}
                      className="p-1.5 text-gray-300 hover:text-red-500">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StockBar({ seat }: { seat: CarSeat }): React.JSX.Element {
  if (seat.totalStock === 0) return <div className="h-1.5 w-24 rounded-full bg-gray-100" />;
  const availPct = (seat.availableStock / seat.totalStock) * 100;
  const hsPct = (seat.outOfService / seat.totalStock) * 100;
  return (
    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-100">
      <div className="flex h-full">
        <div className="h-full bg-[#01696e] transition-all" style={{ width: `${availPct}%` }} />
        <div className="h-full bg-orange-300 transition-all" style={{ width: `${hsPct}%` }} />
      </div>
    </div>
  );
}

// ── Page container ─────────────────────────────────────────────────────────

export default function AccessoriesPage(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<Tab>('car-seats');

  const { data: carSeats = [] } = useQuery({
    queryKey: ['car-seats'],
    queryFn: () => api.get<{ seats: CarSeat[] }>('/car-seats').then(r => r.data.seats),
    staleTime: 2 * 60_000,
  });
  const outOfStockCount = carSeats.filter(s => s.availableStock === 0).length;

  return (
    <div className="p-4 lg:p-6">
      <h1 className="mb-5 text-xl font-bold text-gray-900">Accessoires &amp; Sièges auto</h1>

      <div className="mb-5 flex gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1 w-fit">
        <TabBtn
          label="Sièges auto"
          active={activeTab === 'car-seats'}
          onClick={() => setActiveTab('car-seats')}
          badge={outOfStockCount > 0 ? outOfStockCount : undefined}
        />
        <TabBtn label="Accessoires" active={activeTab === 'accessories'} onClick={() => setActiveTab('accessories')} testId="tab-accessoires" />
      </div>

      {activeTab === 'accessories' ? <AccessoriesTab /> : <CarSeatsTab />}
    </div>
  );
}

function TabBtn({ label, active, onClick, badge, testId }: {
  label: string; active: boolean; onClick: () => void; badge?: number | undefined; testId?: string;
}): React.JSX.Element {
  return (
    <button type="button" onClick={onClick} data-testid={testId}
      className={`relative flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
        active ? 'bg-white text-[#01696e] shadow-sm' : 'text-gray-500 hover:text-gray-700'
      }`}>
      {label}
      {badge !== undefined && (
        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
          {badge}
        </span>
      )}
    </button>
  );
}
