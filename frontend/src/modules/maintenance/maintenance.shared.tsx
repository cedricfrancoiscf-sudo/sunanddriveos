// Types, helpers et modal partagés entre MaintenancePage (/maintenance) et CTPage (/ct)
import React, { useState } from 'react';
import { format, addMonths } from 'date-fns';
import { fr } from 'date-fns/locale';
import { DocumentScanner } from '../../components/ui/DocumentScanner';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Vehicle {
  id: string;
  make: string;
  model: string;
  licensePlate: string;
  isActive?: boolean;
  vehicleCategory?: string;
  deliveryPointName?: string | null;
  parkingZone?: string | null;
  currentMileage?: number | null;
}

export type CtResult = 'favorable' | 'defavorable' | 'contre_visite';

// Doit rester identique à TaskAlertStatus (backend, maintenance.service.ts) —
// c'est le backend qui décide, jamais le frontend (cf. classifyTaskStatus).
export type TaskStatus = 'contre_visite' | 'overdue' | 'urgent' | 'soon' | 'ok' | 'unknown';

export interface MaintenanceTask {
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
  alertStatus: TaskStatus;
  vehicle: Vehicle;
}

export interface Maintenance {
  id: string;
  type: string;
  performedAt: string;
  mileageAtService: number;
  nextServiceDate: string | null;
  nextServiceMileage: number | null;
  cost: number | null;
  provider: string | null;
  notes: string | null;
  ctResult: string | null;
  vehicle: Vehicle;
}

// ─── Statut — décidé par le backend (classifyTaskStatus), jamais recalculé ici ─

export function computeTaskStatus(task: MaintenanceTask): TaskStatus {
  return task.alertStatus ?? 'unknown';
}

export function alertMessage(task: MaintenanceTask): { text: string; color: 'red' | 'orange' } {
  const label = task.type === 'ct' ? 'CT' : 'Révision';
  const status = computeTaskStatus(task);
  const v = `${task.vehicle.make} ${task.vehicle.model} (${task.vehicle.licensePlate})`;

  if (status === 'contre_visite' && task.ctCounterVisitDeadline) {
    return { text: `${v} — Contre-visite obligatoire avant le ${format(new Date(task.ctCounterVisitDeadline), 'dd/MM/yyyy', { locale: fr })}`, color: 'red' };
  }
  if (status === 'overdue' && task.nextDueDate) {
    return { text: `${v} — ${label} en retard, échéance dépassée le ${format(new Date(task.nextDueDate), 'dd/MM/yyyy', { locale: fr })}`, color: 'red' };
  }
  if (status === 'urgent' && task.nextDueDate) {
    return { text: `${v} — ${label} urgent, échéance le ${format(new Date(task.nextDueDate), 'dd/MM/yyyy', { locale: fr })}`, color: 'orange' };
  }
  if (status === 'soon' && task.nextDueDate) {
    return { text: `${v} — ${label} à renouveler avant le ${format(new Date(task.nextDueDate), 'dd/MM/yyyy', { locale: fr })}`, color: 'orange' };
  }
  return { text: `${v} — ${label} : date inconnue`, color: 'orange' };
}

// ─── Composants visuels ───────────────────────────────────────────────────────

export function StatusBadge({ status }: { status: TaskStatus }): React.JSX.Element {
  const map: Record<TaskStatus, string> = {
    contre_visite: 'bg-red-100 text-red-800 border-red-200',
    overdue: 'bg-red-100 text-red-700 border-red-200',
    urgent: 'bg-orange-100 text-orange-800 border-orange-300',
    soon: 'bg-orange-100 text-orange-700 border-orange-200',
    ok: 'bg-green-100 text-green-700 border-green-200',
    unknown: 'bg-gray-100 text-gray-500 border-gray-200',
  };
  const labels: Record<TaskStatus, string> = {
    contre_visite: 'Contre-visite',
    overdue: 'En retard',
    urgent: 'Urgent',
    soon: 'Bientôt',
    ok: 'OK',
    unknown: 'Non renseigné',
  };
  return <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${map[status]}`}>{labels[status]}</span>;
}

export function AlertBanner({ tasks }: { tasks: MaintenanceTask[] }): React.JSX.Element | null {
  const redAlerts = tasks.filter(t => { const s = computeTaskStatus(t); return s === 'overdue' || s === 'contre_visite'; });
  const orangeAlerts = tasks.filter(t => { const s = computeTaskStatus(t); return s === 'urgent' || s === 'soon' || s === 'unknown'; });

  if (redAlerts.length === 0 && orangeAlerts.length === 0) return null;

  return (
    <div className="space-y-3">
      {redAlerts.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="mb-2 text-sm font-semibold text-red-800">{redAlerts.length} alerte{redAlerts.length > 1 ? 's' : ''} urgente{redAlerts.length > 1 ? 's' : ''}</p>
          <div className="space-y-1">{redAlerts.map(t => <p key={t.id} className="text-xs text-red-700">{alertMessage(t).text}</p>)}</div>
        </div>
      )}
      {orangeAlerts.length > 0 && (
        <div className="rounded-xl border border-orange-200 bg-orange-50 p-4">
          <p className="mb-2 text-sm font-semibold text-orange-700">{orangeAlerts.length} échéance{orangeAlerts.length > 1 ? 's' : ''} à prévoir</p>
          <div className="space-y-1">{orangeAlerts.map(t => <p key={t.id} className="text-xs text-orange-600">{alertMessage(t).text}</p>)}</div>
        </div>
      )}
    </div>
  );
}

// ─── Modal enregistrement tâche ───────────────────────────────────────────────

interface TaskModalProps {
  task: MaintenanceTask;
  onClose: () => void;
  onSubmit: (id: string, data: object) => void;
  isPending: boolean;
}

export function TaskModal({ task, onClose, onSubmit, isPending }: TaskModalProps): React.JSX.Element {
  const today = new Date().toISOString().slice(0, 10);
  const isCt = task.type === 'ct';
  const ctIntervalMonths = task.vehicle.vehicleCategory === 'tourisme' ? 24 : 12;

  const [form, setForm] = useState({
    performedAt: today,
    mileageAtService: String(task.vehicle.currentMileage ?? task.lastMileage ?? ''),
    cost: '',
    provider: task.lastProvider ?? '',
    notes: '',
    ctResult: '' as '' | CtResult,
    nextDueDate: isCt
      ? format(addMonths(new Date(today), ctIntervalMonths), 'yyyy-MM-dd')
      : task.intervalMonths
        ? format(addMonths(new Date(today), task.intervalMonths), 'yyyy-MM-dd')
        : '',
    nextDueMileage: !isCt && task.intervalKm && (task.vehicle.currentMileage ?? task.lastMileage)
      ? String((task.vehicle.currentMileage ?? task.lastMileage ?? 0) + task.intervalKm)
      : '',
  });

  const typeLabel = isCt ? 'Contrôle technique' : 'Révision';

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
      : (r === 'defavorable' || r === 'contre_visite')
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
            <p className="text-xs text-gray-500 mt-0.5">{task.vehicle.make} {task.vehicle.model} · {task.vehicle.licensePlate}</p>
          </div>
          <DocumentScanner
            type="maintenance"
            label="Scanner"
            onResult={(data) => {
              if (data.cost) setForm(f => ({ ...f, cost: String(data.cost) }));
              if (data.performedAt) onPerformedAtChange((data.performedAt as string).slice(0, 10));
              if (data.mileage) setForm(f => ({ ...f, mileageAtService: String(data.mileage) }));
            }}
          />
        </div>

        {/* CT : résultat obligatoire */}
        {isCt && (
          <div className="rounded-xl border border-gray-200 p-4 space-y-2">
            <p className="text-xs font-semibold text-gray-700">Résultat du contrôle *</p>
            {(['favorable', 'defavorable', 'contre_visite'] as CtResult[]).map(r => (
              <label key={r} className="flex cursor-pointer items-center gap-2.5">
                <input type="radio" name="ctResult" value={r} checked={form.ctResult === r}
                  onChange={() => onCtResultChange(r)} className="accent-[#01696e]" required />
                <span className={`text-sm ${r === 'favorable' ? 'text-green-700 font-medium' : 'text-red-700 font-medium'}`}>
                  {r === 'favorable' ? 'Favorable ✅' : r === 'defavorable' ? 'Défavorable — contre-visite requise ⚠️' : 'Contre-visite effectuée ✅'}
                </span>
              </label>
            ))}
            {(form.ctResult === 'defavorable' || form.ctResult === 'contre_visite') && form.performedAt && (
              <p className="text-xs font-medium text-red-600 mt-1">
                Contre-visite avant le {format(addMonths(new Date(form.performedAt), 2), 'dd/MM/yyyy', { locale: fr })}
              </p>
            )}
            <p className="text-xs text-gray-400">
              {task.vehicle.vehicleCategory === 'tourisme' ? 'Tourisme : prochain CT dans 24 mois si favorable' : 'Utilitaire/camionnette : prochain CT dans 12 mois si favorable'}
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
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" placeholder="50000" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Coût TTC (€) *</label>
            <input type="number" required min={0} step="0.01" value={form.cost}
              onChange={e => setForm(f => ({ ...f, cost: e.target.value }))}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" placeholder="120.00" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Prestataire</label>
            <input type="text" value={form.provider}
              onChange={e => setForm(f => ({ ...f, provider: e.target.value }))}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" placeholder="Garage Dupont" />
          </div>
          <div className={isCt ? 'sm:col-span-2' : ''}>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Prochaine date
              <span className="ml-1 font-normal text-gray-400">(auto-calculé)</span>
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
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" placeholder="65000" />
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

// ─── Carte tâche ──────────────────────────────────────────────────────────────

interface TaskCardProps {
  task: MaintenanceTask;
  onUpdate: (t: MaintenanceTask) => void;
  history?: Maintenance[];  // facultatif, affiché en accordéon si fourni
}

export function TaskCard({ task, onUpdate, history }: TaskCardProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const status = computeTaskStatus(task);
  const isCt = task.type === 'ct';
  const typeLabel = isCt ? 'Contrôle technique' : 'Révision';

  const borderClass = status === 'overdue' || status === 'contre_visite'
    ? 'border-red-200' : status === 'urgent' ? 'border-orange-300' : status === 'soon' ? 'border-orange-200' : 'border-gray-200';

  const ctResultLabel: Record<CtResult, string> = {
    favorable: 'Favorable ✅',
    defavorable: 'Défavorable ⚠️',
    contre_visite: 'Contre-visite effectuée ✅',
  };

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
    <div className={`rounded-xl border bg-white shadow-sm transition-colors ${borderClass}`}>
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className={status === 'overdue' || status === 'contre_visite' ? 'text-red-500' : status === 'urgent' || status === 'soon' ? 'text-orange-500' : 'text-gray-400'}>
              {icon}
            </span>
            <div>
              <p className="text-sm font-semibold text-gray-900">{typeLabel}</p>
              <p className="text-xs text-gray-500">{task.vehicle.make} {task.vehicle.model} · <span className="font-mono">{task.vehicle.licensePlate}</span></p>
              {(task.vehicle.deliveryPointName ?? task.vehicle.parkingZone) && (
                <p className="text-xs text-gray-400">{task.vehicle.deliveryPointName ?? task.vehicle.parkingZone}</p>
              )}
              {task.vehicle.currentMileage != null && (
                <p className="text-xs text-gray-400">{task.vehicle.currentMileage.toLocaleString('fr-FR')} km</p>
              )}
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
          {task.occurrenceCount > 0 && (
            <div className="flex justify-between pt-1 border-t border-gray-100">
              <span>{task.occurrenceCount} occurrence{task.occurrenceCount > 1 ? 's' : ''}</span>
              <span>Total : {task.totalCost.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</span>
            </div>
          )}
        </div>

        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => onUpdate(task)}
            className="flex-1 rounded-lg border border-[#01696e]/30 px-3 py-1.5 text-xs font-semibold text-[#01696e] hover:bg-[#01696e]/5 transition-colors">
            {task.occurrenceCount === 0 ? 'Saisir le premier' : `Enregistrer ${typeLabel.toLowerCase()}`}
          </button>
          {history && history.length > 0 && (
            <button type="button" onClick={() => setExpanded(v => !v)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50">
              Historique ({history.length})
            </button>
          )}
        </div>
      </div>

      {/* Accordéon historique */}
      {expanded && history && history.length > 0 && (
        <div className="border-t border-gray-100 px-4 pb-3 pt-2 space-y-1.5">
          {history.slice(0, 8).map(m => (
            <div key={m.id} className="flex items-center justify-between text-xs text-gray-500">
              <div className="flex gap-2">
                <span>{format(new Date(m.performedAt), 'dd/MM/yyyy', { locale: fr })}</span>
                <span className="capitalize text-gray-400">{m.type}</span>
                {m.provider && <span className="text-gray-400">{m.provider}</span>}
              </div>
              {m.cost != null && (
                <span className="shrink-0">{m.cost.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</span>
              )}
            </div>
          ))}
          {history.length > 8 && (
            <p className="text-xs text-gray-400 text-center">…et {history.length - 8} autres</p>
          )}
        </div>
      )}
    </div>
  );
}
