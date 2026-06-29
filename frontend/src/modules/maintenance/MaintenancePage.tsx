import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, isPast, differenceInDays, addMonths } from 'date-fns';
import { fr } from 'date-fns/locale';
import { api } from '../../utils/api';
import { DocumentScanner } from '../../components/ui/DocumentScanner';
import { TaskCard, TaskModal, AlertBanner, type MaintenanceTask, type Maintenance, type Vehicle } from './maintenance.shared';

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

// Types uniquement ponctuels (CT et révision/vidange gérés via les tâches)
const TYPES_PONCTUELS = ['pneus', 'freins', 'bougies', 'amortisseurs', 'courroie', 'éclairage', 'filtres', 'autre'];

// Types récurrents (ne pas afficher dans la section ponctuels)
const TYPES_RECURRENTS = new Set(['revision', 'vidange', 'ct']);

// Intervalles recommandés par type (km / mois)
const INTERVALS: Record<string, { km: number | null; months: number | null; label: string }> = {
  pneus:         { km: 40000,  months: 48,   label: 'tous les 40 000 km ou 4 ans' },
  freins:        { km: 60000,  months: 48,   label: 'tous les 60 000 km ou 4 ans' },
  bougies:       { km: 60000,  months: 48,   label: 'tous les 60 000 km ou 4 ans' },
  amortisseurs:  { km: 80000,  months: null, label: 'tous les 80 000 km' },
  courroie:      { km: 120000, months: 60,   label: 'tous les 120 000 km ou 5 ans' },
  éclairage:     { km: null,   months: null, label: 'selon besoin' },
  filtres:       { km: 30000,  months: 12,   label: 'tous les 30 000 km ou 1 an' },
  autre:         { km: null,   months: null, label: '' },
};

function StatusDot({ nextDate }: { nextDate: string | null }): React.JSX.Element {
  if (!nextDate) return <span className="h-2 w-2 rounded-full bg-gray-200" />;
  const d = new Date(nextDate);
  if (isPast(d)) return <span className="h-2 w-2 rounded-full bg-red-500" />;
  if (differenceInDays(d, new Date()) <= 30) return <span className="h-2 w-2 rounded-full bg-orange-400" />;
  return <span className="h-2 w-2 rounded-full bg-green-400" />;
}

export default function MaintenancePage(): React.JSX.Element {
  const qc = useQueryClient();
  const [selectedTask, setSelectedTask] = useState<MaintenanceTask | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [filterVehicleId, setFilterVehicleId] = useState('');
  const [form, setForm] = useState({
    vehicleId: '', type: 'pneus',
    performedAt: new Date().toISOString().slice(0, 16),
    mileageAtService: '', cost: '', provider: '', notes: '',
    nextDueDate: '', nextDueMileage: '',
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
      setForm({ vehicleId: '', type: 'pneus', performedAt: new Date().toISOString().slice(0, 16), mileageAtService: '', cost: '', provider: '', notes: '', nextDueDate: '', nextDueMileage: '' });
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
      nextServiceDate: form.nextDueDate ? new Date(form.nextDueDate).toISOString() : undefined,
      nextServiceMileage: form.nextDueMileage ? parseInt(form.nextDueMileage, 10) : undefined,
    });
  }

  // Prestataires fréquents pour le type sélectionné (depuis l'historique)
  const frequentProviders = useMemo(() => {
    const forType = maintenances.filter(m => m.type === form.type && m.provider);
    const counts: Record<string, number> = {};
    forType.forEach(m => { if (m.provider) counts[m.provider] = (counts[m.provider] ?? 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([p]) => p);
  }, [maintenances, form.type]);

  // Tâches révision uniquement
  const revisionTasks = tasks.filter(t => t.type === 'revision');

  // Alertes révision
  const revisionAlerts = revisionTasks;

  // Historique par véhicule (révision + vidange) — alimente les cartes
  const revisionHistory = maintenances.filter(m => ['revision', 'vidange'].includes(m.type));

  // Ponctuels : tout sauf révision, vidange et CT
  const ponctuels = maintenances.filter(m => !TYPES_RECURRENTS.has(m.type));
  const filteredPonctuels = filterVehicleId
    ? ponctuels.filter(m => m.vehicle.id === filterVehicleId)
    : ponctuels;

  const isLoading = tasksLoading || histLoading;

  return (
    <div className="p-4 lg:p-6 space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Entretiens</h1>
          <p className="text-sm text-gray-500">
            {revisionTasks.length} révision{revisionTasks.length !== 1 ? 's' : ''} · {ponctuels.length} ponctuel{ponctuels.length !== 1 ? 's' : ''}
          </p>
        </div>
        {revisionTasks.length === 0 && !tasksLoading && (
          <button
            type="button"
            onClick={() => { void maintenanceApi.initTasks().then(() => qc.invalidateQueries({ queryKey: ['maintenance-tasks'] })); }}
            className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            Initialiser les tâches
          </button>
        )}
      </div>

      {/* Alertes révision */}
      <AlertBanner tasks={revisionAlerts} />

      {/* ── Section 1 : révisions ── */}
      <section>
        <h2 className="mb-3 text-base font-semibold text-gray-900">Révision</h2>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <div className="h-7 w-7 animate-spin rounded-full border-4 border-t-transparent" style={{ borderColor: '#01696e', borderTopColor: 'transparent' }} />
          </div>
        ) : revisionTasks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 py-10 text-center">
            <p className="text-sm text-gray-400">Aucune tâche révision.</p>
            <p className="text-xs text-gray-400 mt-1">Cliquez sur "Initialiser les tâches" pour les créer automatiquement.</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {revisionTasks.map(t => (
              <TaskCard
                key={t.id}
                task={t}
                onUpdate={setSelectedTask}
                history={revisionHistory.filter(m => m.vehicle.id === t.vehicleId)}
              />
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
              <select value={filterVehicleId} onChange={e => setFilterVehicleId(e.target.value)}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs outline-none focus:border-[#01696e]">
                <option value="">Tous les véhicules</option>
                {vehiclesData.map(v => <option key={v.id} value={v.id}>{v.make} {v.model} — {v.licensePlate}</option>)}
              </select>
            )}
            <button type="button" onClick={() => setShowForm(v => !v)}
              className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-white" style={{ backgroundColor: '#01696e' }}>
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Ajouter
            </button>
          </div>
        </div>

        {showForm && (
          <form onSubmit={handleSubmit} className="mb-4 rounded-2xl border border-[#01696e]/20 bg-[#01696e]/5 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">Nouvel entretien ponctuel</h3>
              <DocumentScanner type="maintenance" label="Scanner la facture"
                onResult={(data) => {
                  if (data.type && TYPES_PONCTUELS.includes(data.type as string)) setForm(f => ({ ...f, type: data.type as string }));
                  if (data.cost) setForm(f => ({ ...f, cost: String(data.cost) }));
                  if (data.performedAt) setForm(f => ({ ...f, performedAt: data.performedAt as string }));
                  if (data.mileage) setForm(f => ({ ...f, mileageAtService: String(data.mileage) }));
                }} />
            </div>
            <p className="text-xs text-gray-400 -mt-1">Pour CT et révision, utiliser les tâches récurrentes — "Entretiens" pour la révision, "Contrôle technique" dans le menu.</p>
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
                <select value={form.type} onChange={e => {
                  const t = e.target.value;
                  const iv = INTERVALS[t];
                  const performedDate = form.performedAt ? new Date(form.performedAt) : new Date();
                  const autoDate = iv?.months ? format(addMonths(performedDate, iv.months), 'yyyy-MM-dd') : '';
                  const km = form.mileageAtService && iv?.km ? String(parseInt(form.mileageAtService, 10) + iv.km) : '';
                  setForm(f => ({ ...f, type: t, nextDueDate: autoDate, nextDueMileage: km }));
                }}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]">
                  {TYPES_PONCTUELS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                {INTERVALS[form.type]?.label && (
                  <p className="mt-1 text-[11px] text-gray-400">Recommandé : {INTERVALS[form.type]!.label}</p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Date réalisé *</label>
                <input type="datetime-local" required value={form.performedAt}
                  onChange={e => {
                    const d = e.target.value;
                    const iv = INTERVALS[form.type];
                    const autoDate = iv?.months && d ? format(addMonths(new Date(d), iv.months), 'yyyy-MM-dd') : form.nextDueDate;
                    setForm(f => ({ ...f, performedAt: d, nextDueDate: autoDate }));
                  }}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Kilométrage *</label>
                <input type="number" required min={0} value={form.mileageAtService}
                  onChange={e => {
                    const km = e.target.value;
                    const iv = INTERVALS[form.type];
                    const autoKm = iv?.km && km ? String(parseInt(km, 10) + iv.km) : form.nextDueMileage;
                    setForm(f => ({ ...f, mileageAtService: km, nextDueMileage: autoKm }));
                  }}
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
                {frequentProviders.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {frequentProviders.map(p => (
                      <button key={p} type="button" onClick={() => setForm(f => ({ ...f, provider: p }))}
                        className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-600 hover:border-[#01696e] hover:text-[#01696e]">
                        {p}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  Prochaine date
                  <span className="ml-1 font-normal text-gray-400">(auto-calculé)</span>
                </label>
                <input type="date" value={form.nextDueDate}
                  onChange={e => setForm(f => ({ ...f, nextDueDate: e.target.value }))}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  Prochain km
                  <span className="ml-1 font-normal text-gray-400">(auto-calculé)</span>
                </label>
                <input type="number" min={0} value={form.nextDueMileage}
                  onChange={e => setForm(f => ({ ...f, nextDueMileage: e.target.value }))}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" placeholder="90000" />
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

        {filteredPonctuels.length === 0 ? (
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
                    <span className="text-xs text-gray-400">{m.vehicle.make} {m.vehicle.model} · <span className="font-mono">{m.vehicle.licensePlate}</span></span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-3 text-xs text-gray-500">
                    <span>{format(new Date(m.performedAt), 'dd/MM/yyyy', { locale: fr })}</span>
                    <span>{m.mileageAtService.toLocaleString('fr-FR')} km</span>
                    {m.cost != null && <span>{m.cost.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</span>}
                    {m.provider && <span>{m.provider}</span>}
                  </div>
                </div>
                <button type="button"
                  onClick={() => { if (confirm('Supprimer cet entretien ?')) deleteMutation.mutate(m.id); }}
                  className="shrink-0 p-1 text-gray-300 hover:text-red-500">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

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
