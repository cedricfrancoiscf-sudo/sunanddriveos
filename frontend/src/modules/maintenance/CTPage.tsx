import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { api } from '../../utils/api';
import { TaskCard, TaskModal, AlertBanner, type MaintenanceTask, type Maintenance } from './maintenance.shared';

// ─── API ──────────────────────────────────────────────────────────────────────

const ctApi = {
  listTasks: () =>
    api.get<{ tasks: MaintenanceTask[] }>('/maintenance/tasks').then(r => r.data.tasks),
  updateTask: (id: string, data: object) =>
    api.put<{ task: MaintenanceTask }>(`/maintenance/tasks/${id}`, data).then(r => r.data.task),
  initTasks: () =>
    api.post<{ success: boolean; vehicleCount: number }>('/maintenance/tasks/init').then(r => r.data),
  listAll: () =>
    api.get<{ maintenances: Maintenance[] }>('/maintenance').then(r => r.data.maintenances),
};

// ─── Page CT ─────────────────────────────────────────────────────────────────

export default function CTPage(): React.JSX.Element {
  const qc = useQueryClient();
  const [selectedTask, setSelectedTask] = useState<MaintenanceTask | null>(null);

  const { data: allTasks = [], isLoading: tasksLoading } = useQuery({
    queryKey: ['maintenance-tasks'],
    queryFn: () => ctApi.listTasks(),
    staleTime: 2 * 60_000,
  });

  const { data: allMaintenances = [], isLoading: histLoading } = useQuery({
    queryKey: ['maintenances'],
    queryFn: () => ctApi.listAll(),
    staleTime: 2 * 60_000,
  });

  const updateTaskMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: object }) => ctApi.updateTask(id, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['maintenance-tasks'] });
      void qc.invalidateQueries({ queryKey: ['maintenances'] });
      setSelectedTask(null);
    },
  });

  type CTSortKey = 'licensePlate' | 'performedAt' | 'nextServiceDate' | 'cost';
  const [ctSortKey, setCtSortKey] = useState<CTSortKey>('nextServiceDate');
  const [ctSortDir, setCtSortDir] = useState<'asc' | 'desc'>('asc');

  function toggleCtSort(k: CTSortKey) {
    if (ctSortKey === k) setCtSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setCtSortKey(k); setCtSortDir('asc'); }
  }

  function CTSortTh({ k, label, right }: { k: CTSortKey; label: string; right?: boolean }): React.JSX.Element {
    const active = ctSortKey === k;
    return (
      <th className={`px-4 py-2.5 text-xs font-medium cursor-pointer select-none hover:text-gray-800 transition-colors ${right ? 'text-right' : 'text-left'} ${active ? 'text-[#01696e]' : 'text-gray-500'}`}
        onClick={() => toggleCtSort(k)}>
        {label}{active ? (ctSortDir === 'desc' ? ' ↓' : ' ↑') : ' ↕'}
      </th>
    );
  }

  // Tâches CT uniquement
  const ctTasks = allTasks.filter(t => t.type === 'ct');

  // Historique CT : tous les Maintenance type="ct"
  const ctHistory = allMaintenances
    .filter(m => m.type === 'ct')
    .sort((a, b) => {
      let cmp = 0;
      if (ctSortKey === 'licensePlate') cmp = a.vehicle.licensePlate.localeCompare(b.vehicle.licensePlate, 'fr');
      else if (ctSortKey === 'performedAt') cmp = new Date(a.performedAt).getTime() - new Date(b.performedAt).getTime();
      else if (ctSortKey === 'nextServiceDate') {
        const aT = a.nextServiceDate ? new Date(a.nextServiceDate).getTime() : Infinity;
        const bT = b.nextServiceDate ? new Date(b.nextServiceDate).getTime() : Infinity;
        cmp = aT - bT;
      } else if (ctSortKey === 'cost') cmp = (a.cost ?? 0) - (b.cost ?? 0);
      return ctSortDir === 'desc' ? -cmp : cmp;
    });

  const isLoading = tasksLoading || histLoading;

  return (
    <div className="p-4 lg:p-6 space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Contrôle technique</h1>
          <p className="text-sm text-gray-500">
            {ctTasks.length} véhicule{ctTasks.length !== 1 ? 's' : ''} · {ctHistory.length} contrôle{ctHistory.length !== 1 ? 's' : ''} enregistré{ctHistory.length !== 1 ? 's' : ''}
          </p>
        </div>
        {ctTasks.length === 0 && !tasksLoading && (
          <button
            type="button"
            onClick={() => { void ctApi.initTasks().then(() => qc.invalidateQueries({ queryKey: ['maintenance-tasks'] })); }}
            className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            Initialiser les tâches
          </button>
        )}
      </div>

      {/* Alertes CT */}
      <AlertBanner tasks={ctTasks} />

      {/* ── Section 1 : tâches CT ── */}
      <section>
        <h2 className="mb-3 text-base font-semibold text-gray-900">Contrôle technique</h2>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <div className="h-7 w-7 animate-spin rounded-full border-4 border-t-transparent" style={{ borderColor: '#01696e', borderTopColor: 'transparent' }} />
          </div>
        ) : ctTasks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 py-10 text-center">
            <p className="text-sm text-gray-400">Aucune tâche CT.</p>
            <p className="text-xs text-gray-400 mt-1">Cliquez sur "Initialiser les tâches" pour les créer automatiquement.</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ctTasks.map(t => (
              <TaskCard key={t.id} task={t} onUpdate={setSelectedTask} />
            ))}
          </div>
        )}
      </section>

      {/* ── Section 2 : historique CT global ── */}
      <section>
        <h2 className="mb-3 text-base font-semibold text-gray-900">Historique</h2>
        {ctHistory.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 py-10 text-center">
            <p className="text-sm text-gray-400">Aucun contrôle technique enregistré</p>
            <p className="text-xs text-gray-400 mt-1">Utilisez le bouton "Enregistrer CT" sur chaque carte véhicule.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <CTSortTh k="licensePlate" label="Véhicule" />
                  <CTSortTh k="performedAt" label="Date" />
                  <th className="px-4 py-2.5 text-xs font-medium text-left text-gray-500">Résultat</th>
                  <CTSortTh k="nextServiceDate" label="Prochain" />
                  <CTSortTh k="cost" label="Coût" right />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {ctHistory.map(m => (
                  <tr key={m.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-gray-900">{m.vehicle.make} {m.vehicle.model}</p>
                      <p className="text-xs font-mono text-gray-400">{m.vehicle.licensePlate}</p>
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">
                      {format(new Date(m.performedAt), 'dd/MM/yyyy', { locale: fr })}
                    </td>
                    <td className="px-4 py-2.5">
                      {m.provider ? (
                        <span className="text-gray-500 text-xs">{m.provider}</span>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">
                      {m.nextServiceDate ? format(new Date(m.nextServiceDate), 'dd/MM/yyyy', { locale: fr }) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-600 whitespace-nowrap">
                      {m.cost != null ? m.cost.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
