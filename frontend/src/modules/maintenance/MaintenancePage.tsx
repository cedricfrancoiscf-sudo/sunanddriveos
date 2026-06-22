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
  vehicleCategory?: string; // "tourisme" | "utilitaire" | "camionnette"
}

type CtResult = 'favorable' | 'defavorable' | 'contre_visite';

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
  ctResult: CtResult | null;
  ctCounterVisitDeadline: string | null;
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

const TYPES_PONCTUELS = ['vidange', 'freins', 'pneus', 'courroie', 'filtres', 'amortisseurs', 'bougies', 'éclairage', 'autre'];

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

type TaskStatus = 'contre_visite' | 'overdue' | 'soon' | 'ok' | 'unknown';

function computeTaskStatus(task: MaintenanceTask): TaskStatus {
  // Contre-visite CT : priorité absolue
  if (task.ctCounterVisitDeadline && (task.ctResult === 'defavorable' || task.ctResult === 'contre_visite')) {
    return 'contre_visite';
  }
  if (!task.nextDueDate && task.occurrenceCount === 0) return 'unknown';
  if (!task.nextDueDate) return 'ok';
  const d = new Date(task.nextDueDate);
  if (isPast(d)) return 'overdue';
  const threshold = task.type === 'ct' ? 60 : 30;
  if (differenceInDays(d, new Date()) <= threshold) return 'soon';
  return 'ok';
}

function alertMessage(task: MaintenanceTask): { text: string; color: 'red' | 'orange' } {
  const label = task.type === 'ct' ? 'CT' : 'Révision';
  const status = computeTaskStatus(task);

  if (status === 'contre_visite' && task.ctCounterVisitDeadline) {
    return {
      text: `${task.vehicle.make} ${task.vehicle.model} (${task.vehicle.licensePlate}) — Contre-visite obligatoire avant le ${format(new Date(task.ctCounterVisitDeadline), 'dd/MM/yyyy', { locale: fr })}`,
      color: 'red',
    };
  }
  if (status === 'overdue' && task.nextDueDate) {
    return {
      text: `${task.vehicle.make} ${task.vehicle.model} (${task.vehicle.licensePlate}) — ${label} en retard, échéance dépassée le ${format(new Date(task.nextDueDate), 'dd/MM/yyyy', { locale: fr })}`,
      color: 'red',
    };
  }
  if (status === 'soon' && task.nextDueDate) {
    return {
      text: `${task.vehicle.make} ${task.vehicle.model} (${task.vehicle.licensePlate}) — ${label} à renouveler avant le ${format(new Date(task.nextDueDate), 'dd/MM/yyyy', { locale: fr })}`,
      color: 'orange',
    };
  }
  return {
    text: `${task.vehicle.make} ${task.vehicle.model} (${task.vehicle.licensePlate}) — ${label} : date inconnue`,
    color: 'orange',
  };
}

function StatusBadge({ status }: { status: TaskStatus }): React.JSX.Element {
  const map: Record<TaskStatus, string> = {
    contre_visite: 'bg-red-100 text-red-800 border-red-200',
    overdue: 'bg-red-100 text-red-700 border-red-200',
    soon: 'bg-orange-100 text-orange-700 border-orange-200',
    ok: 'bg-green-100 text-green-700 border-green-200',
    unknown: 'bg-gray-100 text-gray-500 border-gray-200',
  };
  const labels: Record<TaskStatus, string> = {
    contre_visite: 'Contre-visite',
    overdue: 'En retard',
    soon: 'Bientôt',
    ok: 'OK',
    unknown: 'Non renseigné',
  };
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

// ─── Modal enregistrement tâche récurrente ────────────────────────────────────

interface TaskModalProps {
  task: MaintenanceTask;
  onClose: () => void;
  onSubmit: (id: string, data: object) => void;
  isPending: boolean;
}

function TaskModal({ task, onClose, onSubmit, isPending }: TaskModalProps): React.JSX.Element {
  const today = new Date().toISOString().slice(0, 10);
  const ctIntervalMonths = task.vehicle.vehicleCategory === 'tourisme' ? 24 : 12;

  const [form, setForm] = useState({
    performedAt: today,
    mileageAtService: String(task.lastMileage ?? ''),
    cost: '',
    provider: task.lastProvider ?? '',
    notes: '',
    ctResult: '' as '' | CtResult,
    nextDueDate: task.type === 'revision' && task.intervalMonths
      ? format(addMonths(new Date(today), task.intervalMonths), 'yyyy-MM-dd')
      : '',
    nextDueMileage: task.type === 'revision' && task.intervalKm && task.lastMileage
      ? String(task.lastMileage + task.intervalKm)
      : '',
  });

  const typeLabel = task.type === 'ct' ? 'Contrôle technique' : 'Révision';
  const isCt = task.type === 'ct';

  // Recalcul auto nextDueDate quand performedAt change
  function onPerformedAtChange(d: string): void {
    setForm(f => ({
      ...f,
      performedAt: d,
      nextDueDate: isCt && f.ctResult === 'favorable'
        ? format(addMonths(new Date(d), ctIntervalMonths), 'yyyy-MM-dd')
        : !isCt && task.intervalMonths
          ? format(addMonths(new Date(d), task.intervalMonths), 'yyyy-MM-dd')
          : f.nextDueDate,
      nextDueMileage: !isCt && task.intervalKm && f.mileageAtService
        ? String(parseInt(f.mileageAtService, 10) + task.intervalKm)
        : f.nextDueMileage,
    }));
  }

  function onCtResultChange(r: CtResult): void {
    const nd = r === 'favorable'
      ? format(addMonths(new Date(form.performedAt), ctIntervalMonths), 'yyyy-MM-dd')
      : r === 'defavorable' || r === 'contre_visite'
        ? format(addMonths(new Date(form.performedAt), 2), 'yyyy-MM-dd')
        : '';
    setForm(f => ({ ...f, ctResult: r, nextDueDate: nd }));
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (isCt && !form.ctResult) return;
    onSubmit(task.id, {
      performedAt: new Date(form.performedAt).toISOString(),
      mileageAtService: parseInt(form.mileageAtService, 10),
      cost: parseFloat(form.cost) || 0,
      provider: form.provider || undefined,
      notes: form.notes || undefined,
      ctResult: form.ctResult || undefined,
      nextDueDate: form.nextDueDate ? new Date(form.nextDueDate).toISOString() : undefined,
      nextDueMileage: form.nextDueMileage ? parseInt(form.nextDueMileage, 10) : undefined,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <form
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl space-y-4 my-auto"
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
              if (data.performedAt) {
                const d = (data.performedAt as string).slice(0, 10);
                onPerformedAtChange(d);
              }
              if (data.mileage) setForm(f => ({ ...f, mileageAtService: String(data.mileage) }));
            }}
          />
        </div>

        {/* CT : résultat obligatoire en premier */}
        {isCt && (
          <div className="rounded-xl border border-gray-200 p-4 space-y-2">
            <p className="text-xs font-semibold text-gray-700">Résultat du contrôle *</p>
            <div className="space-y-2">
              {(['favorable', 'defavorable', 'contre_visite'] as CtResult[]).map(r => (
                <label key={r} className="flex cursor-pointer items-center gap-2.5">
                  <input
                    type="radio"
                    name="ctResult"
                    value={r}
                    checked={form.ctResult === r}
                    onChange={() => onCtResultChange(r)}
                    className="accent-[#01696e]"
                    required
                  />
                  <span className={`text-sm ${r === 'favorable' ? 'text-green-700 font-medium' : 'text-red-700 font-medium'}`}>
                    {r === 'favorable' ? 'Favorable ✅' : r === 'defavorable' ? 'Défavorable — contre-visite requise ⚠️' : 'Contre-visite effectuée ✅'}
                  </span>
                </label>
              ))}
            </div>
            {(form.ctResult === 'defavorable' || form.ctResult === 'contre_visite') && form.performedAt && (
              <p className="text-xs font-medium text-red-600 mt-1">
                Contre-visite à effectuer avant le {format(addMonths(new Date(form.performedAt), 2), 'dd/MM/yyyy', { locale: fr })}
              </p>
            )}
            <p className="text-xs text-gray-400">
              {task.vehicle.vehicleCategory === 'tourisme' ? 'Tourisme : prochain CT dans 24 mois si favorable' : 'Utilitaire / camionnette : prochain CT dans 12 mois si favorable'}
              {' · '}Contre-visite dans 2 mois si défavorable
            </p>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Date réalisé *</label>
            <input type="date" required value={form.performedAt}
              onChange={e => onPerformedAtChange(e.target.value)}
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
                  nextDueMileage: !isCt && task.intervalKm && km
                    ? String(parseInt(km, 10) + task.intervalKm)
                    : f.nextDueMileage,
                }));
              }}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]"
              placeholder="50000" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Coût TTC (€) *</label>
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
          <div className={isCt ? 'sm:col-span-2' : ''}>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Prochaine date
              {!isCt && task.intervalMonths && (
                <span className="ml-1 font-normal text-gray-400">(auto-calculé)</span>
              )}
              {isCt && (
                <span className="ml-1 font-normal text-gray-400">(selon résultat)</span>
              )}
            </label>
            <input type="date" value={form.nextDueDate}
              onChange={e => setForm(f => ({ ...f, nextDueDate: e.target.value }))}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
          </div>
          {!isCt && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Prochain km
                {task.intervalKm && <span className="ml-1 font-normal text-gray-400">(auto-calculé)</span>}
              </label>
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
          <button type="submit" disabled={isPending || (isCt && !form.ctResult)}
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
  const status = computeTaskStatus(task);
  const isCt = task.type === 'ct';
  const typeLabel = isCt ? 'Contrôle technique' : 'Révision';

  const borderClass = status === 'overdue' || status === 'contre_visite'
    ? 'border-red-200'
    : status === 'soon'
      ? 'border-orange-200'
      : 'border-gray-200';

  const ctResultLabel: Record<CtResult, string> = {
    favorable: 'Favorable ✅',
    defavorable: 'Défavorable ⚠️',
    contre_visite: 'Contre-visite effectuée ✅',
  };

  const ctIntervalLabel = isCt
    ? task.vehicle.vehicleCategory === 'tourisme'
      ? 'Intervalle : 24 mois'
      : 'Intervalle : 12 mois'
    : task.intervalMonths ? `Intervalle : ${task.intervalMonths} mois` : '';

  const icon = isCt ? (
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
    <div className={`rounded-xl border bg-white p-4 shadow-sm transition-colors ${borderClass}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={
            status === 'overdue' || status === 'contre_visite' ? 'text-red-500'
            : status === 'soon' ? 'text-orange-500'
            : 'text-gray-400'
          }>
            {icon}
          </span>
          <div>
            <p className="text-sm font-semibold text-gray-900">{typeLabel}</p>
            <p className="text-xs text-gray-500">{task.vehicle.make} {task.vehicle.model} · <span className="font-mono">{task.vehicle.licensePlate}</span></p>
          </div>
        </div>
        <StatusBadge status={status} />
      </div>

      <div className="mt-3 space-y-1 text-xs text-gray-500">
        <div className="flex justify-between">
          <span>Dernière : {task.lastPerformedAt ? format(new Date(task.lastPerformedAt), 'dd/MM/yyyy', { locale: fr }) : '—'}</span>
          {task.lastCost != null && <span>{task.lastCost.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</span>}
        </div>
        {isCt && task.ctResult && (
          <div className={task.ctResult === 'favorable' ? 'text-green-600' : 'text-red-600 font-medium'}>
            {ctResultLabel[task.ctResult]}
          </div>
        )}
        {status === 'contre_visite' && task.ctCounterVisitDeadline && (
          <div className="text-red-600 font-semibold">
            Contre-visite avant le {format(new Date(task.ctCounterVisitDeadline), 'dd/MM/yyyy', { locale: fr })}
          </div>
        )}
        <div className="flex justify-between">
          <span>Prochaine : {task.nextDueDate ? format(new Date(task.nextDueDate), 'dd/MM/yyyy', { locale: fr }) : '—'}</span>
          {task.nextDueMileage != null && <span>→ {task.nextDueMileage.toLocaleString('fr-FR')} km</span>}
        </div>
        {ctIntervalLabel && <span className="text-gray-400">{ctIntervalLabel}</span>}
        {task.occurrenceCount > 0 && (
          <div className="flex justify-between pt-1 border-t border-gray-100">
            <span>{task.occurrenceCount} occurrence{task.occurrenceCount > 1 ? 's' : ''}</span>
            <span>Coût total : {task.totalCost.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</span>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => onUpdate(task)}
        className="mt-3 w-full rounded-lg border border-[#01696e]/30 px-3 py-1.5 text-xs font-semibold text-[#01696e] hover:bg-[#01696e]/5 transition-colors"
      >
        {task.occurrenceCount === 0 ? 'Saisir le premier' : `Enregistrer ${typeLabel.toLowerCase()}`}
      </button>
    </div>
  );
}

// ─── Page principale ──────────────────────────────────────────────────────────

export default function MaintenancePage(): React.JSX.Element {
  const qc = useQueryClient();
  const [selectedTask, setSelectedTask] = useState<MaintenanceTask | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [filterVehicleId, setFilterVehicleId] = useState('');
  const [form, setForm] = useState({
    vehicleId: '', type: 'vidange', performedAt: new Date().toISOString().slice(0, 16),
    mileageAtService: '', cost: '', provider: '', notes: '',
  });

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
    queryFn: () => api.get<{ vehicles: Vehicle[] }>('/vehicles').then(r => r.data.vehicles),
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

  // Alertes : tâches en retard, bientôt, contre-visite, ou inconnues
  const taskAlerts = tasks.filter(t => {
    const s = computeTaskStatus(t);
    return s === 'overdue' || s === 'soon' || s === 'contre_visite' || s === 'unknown';
  });

  // Séparer les alertes rouges des oranges
  const redAlerts = taskAlerts.filter(t => {
    const s = computeTaskStatus(t);
    return s === 'overdue' || s === 'contre_visite';
  });
  const orangeAlerts = taskAlerts.filter(t => computeTaskStatus(t) === 'soon' || computeTaskStatus(t) === 'unknown');

  // Historique ponctuel uniquement (revision et ct gérés via tâches)
  const ponctuels = maintenances.filter(m => !['revision', 'ct'].includes(m.type));
  const filteredPonctuels = filterVehicleId
    ? ponctuels.filter(m => m.vehicle.id === filterVehicleId)
    : ponctuels;

  const isLoading = tasksLoading || histLoading;

  return (
    <div className="p-4 lg:p-6 space-y-8">
      {/* En-tête */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Entretiens</h1>
          <p className="text-sm text-gray-500">
            {tasks.length} tâche{tasks.length !== 1 ? 's' : ''} récurrente{tasks.length !== 1 ? 's' : ''} · {ponctuels.length} entretien{ponctuels.length !== 1 ? 's' : ''} ponctuel{ponctuels.length !== 1 ? 's' : ''}
          </p>
        </div>
        {tasks.length === 0 && !tasksLoading && (
          <button
            type="button"
            onClick={() => {
              void maintenanceApi.initTasks().then(() => qc.invalidateQueries({ queryKey: ['maintenance-tasks'] }));
            }}
            className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            Initialiser les tâches
          </button>
        )}
      </div>

      {/* Alertes rouges (urgentes) */}
      {redAlerts.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="mb-2 text-sm font-semibold text-red-800">
            {redAlerts.length} alerte{redAlerts.length > 1 ? 's' : ''} urgente{redAlerts.length > 1 ? 's' : ''}
          </p>
          <div className="space-y-1">
            {redAlerts.map(t => {
              const msg = alertMessage(t);
              return <p key={t.id} className="text-xs text-red-700">{msg.text}</p>;
            })}
          </div>
        </div>
      )}

      {/* Alertes oranges (à venir) */}
      {orangeAlerts.length > 0 && (
        <div className="rounded-xl border border-orange-200 bg-orange-50 p-4">
          <p className="mb-2 text-sm font-semibold text-orange-700">
            {orangeAlerts.length} échéance{orangeAlerts.length > 1 ? 's' : ''} à prévoir
          </p>
          <div className="space-y-1">
            {orangeAlerts.map(t => {
              const msg = alertMessage(t);
              return <p key={t.id} className="text-xs text-orange-600">{msg.text}</p>;
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
          <div className="rounded-xl border border-dashed border-gray-200 py-10 text-center">
            <p className="text-sm text-gray-400">Aucune tâche récurrente.</p>
            <p className="text-xs text-gray-400 mt-1">Cliquez sur "Initialiser les tâches" pour créer automatiquement les entrées CT + Révision de chaque véhicule.</p>
          </div>
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
              onClick={() => setShowForm(v => !v)}
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
            <div className="flex items-center justify-between">
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

            <p className="text-xs text-gray-400 -mt-1">
              Pour CT et révision, utiliser les tâches récurrentes en haut de page.
            </p>

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
                  {TYPES_PONCTUELS.map(t => <option key={t} value={t} className="capitalize">{t}</option>)}
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
                <label className="mb-1 block text-xs font-medium text-gray-600">Coût TTC (€)</label>
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
