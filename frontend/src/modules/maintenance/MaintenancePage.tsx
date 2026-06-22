import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, isPast, differenceInDays, addMonths } from 'date-fns';
import { fr } from 'date-fns/locale';
import { api } from '../../utils/api';
import { DocumentScanner } from '../../components/ui/DocumentScanner';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Vehicle {
  id: string;
  make: string;
  model: string;
  licensePlate: string;
  isActive?: boolean;
}

interface MaintenanceTask {
  id: string;
  vehicleId: string;
  type: 'revision' | 'ct';
  lastPerformedAt: string | null;
  lastMileage: number | null;
  lastCost: number | null;
  lastProvider: string | null;
  lastNotes: string | null;
  nextDueDate: string | null;
  nextDueMileage: number | null;
  intervalKm: number | null;
  intervalMonths: number | null;
  totalCost: number;
  occurrenceCount: number;
  vehicle: Vehicle;
}

interface Maintenance {
  id: string;
  type: string;
  performedAt: string;
  mileageAtService: number;
  nextServiceDate: string | null;
  nextServiceMileage: number | null;
  cost: number | null;
  provider: string | null;
  notes: string | null;
  vehicle: Vehicle;
}

// Types ponctuels uniquement (CT et révision gérés via les tâches récurrentes)
const TYPES = ['vidange', 'freins', 'pneus', 'courroie', 'filtres', 'autre'];

// ─── API ──────────────────────────────────────────────────────────────────────

const maintenanceApi = {
  listTasks: () =>
    api.get<{ tasks: MaintenanceTask[] }>('/maintenance/tasks').then(r => r.data.tasks),
  updateTask: (id: string, data: object) =>
    api.put<{ task: MaintenanceTask }>(`/maintenance/tasks/${id}`, data).then(r => r.data.task),
  initTasks: () =>
    api.post<{ success: boolean; vehicleCount: number }>('/maintenance/tasks/init').then(r => r.data),
  list: () =>
    api.get<{ maintenances: Maintenance[] }>('/maintenance').then(r => r.data.maintenances),
  create: (data: object) =>
    api.post<{ maintenance: Maintenance }>('/maintenance', data).then(r => r.data.maintenance),
  delete: (id: string) => api.delete(`/maintenance/${id}`),
};

// ─── Helpers visuels ─────────────────────────────────────────────────────────

function taskStatus(task: MaintenanceTask): 'overdue' | 'soon' | 'ok' | 'unknown' {
  if (!task.nextDueDate) return 'unknown';
  const d = new Date(task.nextDueDate);
  if (isPast(d)) return 'overdue';
  const threshold = task.type === 'ct' ? 60 : 30;
  if (differenceInDays(d, new Date()) <= threshold) return 'soon';
  return 'ok';
}

function StatusBadge({ status }: { status: ReturnType<typeof taskStatus> }): React.JSX.Element {
  const map = {
    overdue: 'bg-red-100 text-red-700 border-red-200',
    soon: 'bg-orange-100 text-orange-700 border-orange-200',
    ok: 'bg-green-100 text-green-700 border-green-200',
    unknown: 'bg-gray-100 text-gray-500 border-gray-200',
  };
  const labels = { overdue: 'Dépassé', soon: 'Bientôt', ok: 'OK', unknown: 'Inconnu' };
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${map[status]}`}>
      {labels[status]}
    </span>
  );
}

function StatusDot({ nextDate }: { nextDate: string | null }): React.JSX.Element {
  if (!nextDate) return <span className="h-2 w-2 rounded-full bg-gray-200" />;
  const d = new Date(nextDate);
  if (isPast(d)) return <span className="h-2 w-2 rounded-full bg-red-500" title="Dépassé" />;
  const days = differenceInDays(d, new Date());
  if (days <= 30) return <span className="h-2 w-2 rounded-full bg-orange-400" title={`Dans ${days} j`} />;
  return <span className="h-2 w-2 rounded-full bg-green-400" />;
}

// ─── Modal mise à jour tâche ──────────────────────────────────────────────────

interface TaskModalProps {
  task: MaintenanceTask;
  onClose: () => void;
  onSubmit: (id: string, data: object) => void;
  isPending: boolean;
}

function TaskModal({ task, onClose, onSubmit, isPending }: TaskModalProps): React.JSX.Element {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    performedAt: today,
    mileageAtService: String(task.lastMileage ?? ''),
    cost: '',
    provider: task.lastProvider ?? '',
    notes: '',
    nextDueDate: task.intervalMonths
      ? format(addMonths(new Date(today), task.intervalMonths), 'yyyy-MM-dd')
      : '',
    nextDueMileage: task.intervalKm && task.lastMileage
      ? String(task.lastMileage + task.intervalKm)
      : '',
  });

  const typeLabel = task.type === 'ct' ? 'Contrôle technique' : 'Révision';

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    onSubmit(task.id, {
      performedAt: new Date(form.performedAt).toISOString(),
      mileageAtService: parseInt(form.mileageAtService, 10),
      cost: parseFloat(form.cost) || 0,
      provider: form.provider || undefined,
      notes: form.notes || undefined,
      nextDueDate: form.nextDueDate ? new Date(form.nextDueDate).toISOString() : undefined,
      nextDueMileage: form.nextDueMileage ? parseInt(form.nextDueMileage, 10) : undefined,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl space-y-4"
        onClick={e => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-bold text-gray-900">Enregistrer {typeLabel}</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {task.vehicle.make} {task.vehicle.model} · {task.vehicle.licensePlate}
            </p>
          </div>
          <DocumentScanner
            type="maintenance"
            label="Scanner"
            onResult={(data) => {
              if (data.cost) setForm(f => ({ ...f, cost: String(data.cost) }));
              if (data.performedAt) setForm(f => ({ ...f, performedAt: (data.performedAt as string).slice(0, 10) }));
              if (data.mileage) setForm(f => ({ ...f, mileageAtService: String(data.mileage) }));
            }}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Date réalisé *</label>
            <input type="date" required value={form.performedAt}
              onChange={e => {
                const d = e.target.value;
                setForm(f => ({
                  ...f,
                  performedAt: d,
                  nextDueDate: task.intervalMonths
                    ? format(addMonths(new Date(d), task.intervalMonths), 'yyyy-MM-dd')
                    : f.nextDueDate,
                }));
              }}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Kilométrage *</label>
            <input type="number" required min={0} value={form.mileageAtService}
              onChange={e => {
                const km = e.target.value;
                setForm(f => ({
                  ...f,
                  mileageAtService: km,
                  nextDueMileage: task.intervalKm && km
                    ? String(parseInt(km, 10) + task.intervalKm)
                    : f.nextDueMileage,
                }));
              }}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]"
              placeholder="50000" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Coût (€) *</label>
            <input type="number" required min={0} step="0.01" value={form.cost}
              onChange={e => setForm(f => ({ ...f, cost: e.target.value }))}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]"
              placeholder="120.00" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Prestataire</label>
            <input type="text" value={form.provider}
              onChange={e => setForm(f => ({ ...f, provider: e.target.value }))}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]"
              placeholder="Garage Dupont" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Prochaine date</label>
            <input type="date" value={form.nextDueDate}
              onChange={e => setForm(f => ({ ...f, nextDueDate: e.target.value }))}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
          </div>
          {task.type === 'revision' && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Prochain km</label>
              <input type="number" min={0} value={form.nextDueMileage}
                onChange={e => setForm(f => ({ ...f, nextDueMileage: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]"
                placeholder="65000" />
            </div>
          )}
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Notes</label>
          <textarea rows={2} value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
        </div>

        <div className="flex gap-2">
          <button type="submit" disabled={isPending}
            className="rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" style={{ backgroundColor: '#01696e' }}>
            {isPending ? 'Enregistrement...' : 'Enregistrer'}
          </button>
          <button type="button" onClick={onClose}
            className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            Annuler
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Carte tâche récurrente ───────────────────────────────────────────────────

function TaskCard({ task, onUpdate }: { task: MaintenanceTask; onUpdate: (t: MaintenanceTask) => void }): React.JSX.Element {
  const status = taskStatus(task);
  const typeLabel = task.type === 'ct' ? 'Contrôle technique' : 'Révision';
  const icon = task.type === 'ct'
    ? (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    ) : (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    );

  return (
    <div className={`rounded-xl border bg-white p-4 shadow-sm transition-colors ${
      status === 'overdue' ? 'border-red-200' : status === 'soon' ? 'border-orange-200' : 'border-gray-200'
    }`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`text-${status === 'overdue' ? 'red' : status === 'soon' ? 'orange' : 'gray'}-500`}>
            {icon}
          </span>
          <div>
            <p className="text-sm font-semibold text-gray-900">{typeLabel}</p>
            <p className="text-xs text-gray-500">{task.vehicle.make} {task.vehicle.model} · <span className="font-mono">{task.vehicle.licensePlate}</span></p>
          </div>
        </div>
        <StatusBadge status={status} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-500">
        <span>Dernière : {task.lastPerformedAt ? format(new Date(task.lastPerformedAt), 'dd/MM/yyyy', { locale: fr }) : '—'}</span>
        <span>Prochaine : {task.nextDueDate ? format(new Date(task.nextDueDate), 'dd/MM/yyyy', { locale: fr }) : '—'}</span>
        {task.lastMileage != null && <span>{task.lastMileage.toLocaleString('fr-FR')} km</span>}
        {task.nextDueMileage != null && <span>→ {task.nextDueMileage.toLocaleString('fr-FR')} km</span>}
        {task.occurrenceCount > 0 && (
          <span className="col-span-2">{task.occurrenceCount}× · Coût total : {task.totalCost.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</span>
        )}
      </div>

      <button
        type="button"
        onClick={() => onUpdate(task)}
        className="mt-3 w-full rounded-lg border border-[#01696e]/30 px-3 py-1.5 text-xs font-semibold text-[#01696e] hover:bg-[#01696e]/5 transition-colors"
      >
        Enregistrer {typeLabel.toLowerCase()}
      </button>
    </div>
  );
}

// ─── Page principale ──────────────────────────────────────────────────────────

export default function MaintenancePage(): React.JSX.Element {
  const qc = useQueryClient();

  // Modal tâche récurrente
  const [selectedTask, setSelectedTask] = useState<MaintenanceTask | null>(null);

  // Formulaire entretien ponctuel
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    vehicleId: '', type: 'vidange', performedAt: new Date().toISOString().slice(0, 16),
    mileageAtService: '', cost: '', provider: '', notes: '',
  });

  // Filtre véhicule pour l'historique ponctuel
  const [filterVehicleId, setFilterVehicleId] = useState('');

  const { data: tasks = [], isLoading: tasksLoading } = useQuery({
    queryKey: ['maintenance-tasks'],
    queryFn: () => maintenanceApi.listTasks(),
    staleTime: 2 * 60_000,
  });

  const { data: maintenances = [], isLoading: histLoading } = useQuery({
    queryKey: ['maintenances'],
    queryFn: () => maintenanceApi.list(),
    staleTime: 2 * 60_000,
  });

  const { data: vehiclesData } = useQuery({
    queryKey: ['vehicles'],
    queryFn: () =>
      api.get<{ vehicles: Vehicle[] }>('/vehicles').then(r => r.data.vehicles),
    staleTime: 5 * 60_000,
  });

  const updateTaskMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: object }) => maintenanceApi.updateTask(id, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['maintenance-tasks'] });
      void qc.invalidateQueries({ queryKey: ['maintenances'] });
      setSelectedTask(null);
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: object) => maintenanceApi.create(data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['maintenances'] });
      setShowForm(false);
      setForm({ vehicleId: '', type: 'vidange', performedAt: new Date().toISOString().slice(0, 16), mileageAtService: '', cost: '', provider: '', notes: '' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => maintenanceApi.delete(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['maintenances'] }),
  });

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    createMutation.mutate({
      vehicleId: form.vehicleId,
      type: form.type,
      performedAt: new Date(form.performedAt).toISOString(),
      mileageAtService: parseInt(form.mileageAtService, 10),
      cost: form.cost ? parseFloat(form.cost) : undefined,
      provider: form.provider || undefined,
      notes: form.notes || undefined,
    });
  }

  // Alertes à venir issues des tâches récurrentes
  const taskAlerts = tasks.filter(t => {
    const s = taskStatus(t);
    return s === 'overdue' || s === 'soon';
  });

  // Historique ponctuel (hors tâches récurrentes)
  const ponctuels = maintenances.filter(m => !['revision', 'ct'].includes(m.type));
  const filteredPonctuels = filterVehicleId
    ? ponctuels.filter(m => m.vehicle.id === filterVehicleId)
    : ponctuels;

  const isLoading = tasksLoading || histLoading;

  return (
    <div className="p-4 lg:p-6 space-y-8">
      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Entretiens</h1>
          <p className="text-sm text-gray-500">
            {tasks.length} tâche{tasks.length !== 1 ? 's' : ''} récurrente{tasks.length !== 1 ? 's' : ''} · {ponctuels.length} entretien{ponctuels.length !== 1 ? 's' : ''} ponctuel{ponctuels.length !== 1 ? 's' : ''}
          </p>
        </div>
        {tasks.length === 0 && !tasksLoading && (
          <button
            type="button"
            onClick={() => maintenanceApi.initTasks().then(() => qc.invalidateQueries({ queryKey: ['maintenance-tasks'] }))}
            className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            Initialiser les tâches
          </button>
        )}
      </div>

      {/* Alertes tâches récurrentes */}
      {taskAlerts.length > 0 && (
        <div className="rounded-xl border border-orange-200 bg-orange-50 p-4">
          <p className="mb-2 text-sm font-semibold text-orange-700">
            {taskAlerts.length} échéance{taskAlerts.length > 1 ? 's' : ''} à traiter
          </p>
          <div className="space-y-1">
            {taskAlerts.map(t => {
              const label = t.type === 'ct' ? 'CT' : 'Révision';
              return (
                <p key={t.id} className="text-xs text-orange-600">
                  {t.vehicle.make} {t.vehicle.model} ({t.vehicle.licensePlate}) — {label}
                  {t.nextDueDate ? ` · ${format(new Date(t.nextDueDate), 'dd/MM/yyyy', { locale: fr })}` : ' · date inconnue'}
                </p>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Section 1 : tâches récurrentes ── */}
      <section>
        <h2 className="mb-3 text-base font-semibold text-gray-900">Tâches récurrentes</h2>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <div className="h-7 w-7 animate-spin rounded-full border-4 border-t-transparent" style={{ borderColor: '#01696e', borderTopColor: 'transparent' }} />
          </div>
        ) : tasks.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-200 py-10 text-center text-sm text-gray-400">
            Aucune tâche — cliquez sur "Initialiser les tâches" pour créer automatiquement les entrées CT + Révision de chaque véhicule.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {tasks.map(t => (
              <TaskCard key={t.id} task={t} onUpdate={setSelectedTask} />
            ))}
          </div>
        )}
      </section>

      {/* ── Section 2 : entretiens ponctuels ── */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-gray-900">Entretiens ponctuels</h2>
          <div className="flex items-center gap-2">
            {vehiclesData && vehiclesData.length > 1 && (
              <select
                value={filterVehicleId}
                onChange={e => setFilterVehicleId(e.target.value)}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs outline-none focus:border-[#01696e]"
              >
                <option value="">Tous les véhicules</option>
                {vehiclesData.map(v => (
                  <option key={v.id} value={v.id}>{v.make} {v.model} — {v.licensePlate}</option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-white"
              style={{ backgroundColor: '#01696e' }}
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Ajouter
            </button>
          </div>
        </div>

        {/* Formulaire entretien ponctuel */}
        {showForm && (
          <form onSubmit={handleSubmit} className="mb-4 rounded-2xl border border-[#01696e]/20 bg-[#01696e]/5 p-5 space-y-3">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-semibold text-gray-900">Nouvel entretien ponctuel</h3>
              <DocumentScanner
                type="maintenance"
                label="Scanner la facture"
                onResult={(data) => {
                  if (data.type) setForm(f => ({ ...f, type: data.type as string }));
                  if (data.cost) setForm(f => ({ ...f, cost: String(data.cost) }));
                  if (data.performedAt) setForm(f => ({ ...f, performedAt: data.performedAt as string }));
                  if (data.mileage) setForm(f => ({ ...f, mileageAtService: String(data.mileage) }));
                }}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Véhicule *</label>
                <select required value={form.vehicleId} onChange={e => setForm(f => ({ ...f, vehicleId: e.target.value }))}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]">
                  <option value="">Sélectionner...</option>
                  {vehiclesData?.map(v => <option key={v.id} value={v.id}>{v.make} {v.model} — {v.licensePlate}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Type *</label>
                <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]">
                  {TYPES.map(t => <option key={t} value={t} className="capitalize">{t}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Date réalisé *</label>
                <input type="datetime-local" required value={form.performedAt}
                  onChange={e => setForm(f => ({ ...f, performedAt: e.target.value }))}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Kilométrage *</label>
                <input type="number" required min={0} value={form.mileageAtService}
                  onChange={e => setForm(f => ({ ...f, mileageAtService: e.target.value }))}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" placeholder="50000" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Coût (€)</label>
                <input type="number" min={0} step="0.01" value={form.cost}
                  onChange={e => setForm(f => ({ ...f, cost: e.target.value }))}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" placeholder="120.00" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Prestataire</label>
                <input type="text" value={form.provider}
                  onChange={e => setForm(f => ({ ...f, provider: e.target.value }))}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" placeholder="Garage Dupont" />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Notes</label>
              <textarea rows={2} value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={createMutation.isPending}
                className="rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" style={{ backgroundColor: '#01696e' }}>
                {createMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
              </button>
              <button type="button" onClick={() => setShowForm(false)}
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                Annuler
              </button>
            </div>
          </form>
        )}

        {filteredPonctuels.length === 0 && !histLoading ? (
          <div className="rounded-xl border border-dashed border-gray-200 py-10 text-center">
            <p className="text-sm text-gray-400">Aucun entretien ponctuel enregistré</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredPonctuels.map(m => (
              <div key={m.id} className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
                <StatusDot nextDate={m.nextServiceDate} />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium capitalize text-gray-900">{m.type}</span>
                    <span className="text-xs text-gray-400">
                      {m.vehicle.make} {m.vehicle.model} · <span className="font-mono">{m.vehicle.licensePlate}</span>
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-3 text-xs text-gray-500">
                    <span>{format(new Date(m.performedAt), 'dd/MM/yyyy', { locale: fr })}</span>
                    <span>{m.mileageAtService.toLocaleString('fr-FR')} km</span>
                    {m.nextServiceDate && (
                      <span className="text-orange-600">→ {format(new Date(m.nextServiceDate), 'dd/MM/yyyy', { locale: fr })}</span>
                    )}
                    {m.cost != null && <span>{m.cost.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</span>}
                    {m.provider && <span>{m.provider}</span>}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => { if (confirm('Supprimer cet entretien ?')) deleteMutation.mutate(m.id); }}
                  className="shrink-0 p-1 text-gray-300 hover:text-red-500"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Modal enregistrement tâche récurrente */}
      {selectedTask && (
        <TaskModal
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onSubmit={(id, data) => updateTaskMutation.mutate({ id, data })}
          isPending={updateTaskMutation.isPending}
        />
      )}
    </div>
  );
}
