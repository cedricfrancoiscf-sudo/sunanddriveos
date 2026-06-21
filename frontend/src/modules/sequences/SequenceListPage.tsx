import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { api } from '../../utils/api';
import {
  sequencesApi,
  type Sequence,
  type SequenceInput,
  type TriggerEvent,
  TRIGGER_LABELS,
  DELAY_LABELS,
  TEMPLATE_VARS,
} from './sequencesApi';

function delayLabel(minutes: number): string {
  if (minutes === 0) return 'Immédiatement';
  const abs = Math.abs(minutes);
  const dir = minutes < 0 ? ' avant' : ' après';
  if (abs < 60) return `${abs} min${dir}`;
  if (abs < 1440) return `${Math.round(abs / 60)} h${dir}`;
  return `${Math.round(abs / 1440)} j${dir}`;
}

const TRIGGER_OPTIONS: TriggerEvent[] = [
  'rental.booked',
  'rental.before_checkin',
  'rental.car_checked_in',
  'rental.before_checkout',
  'rental.car_checked_out',
];

const EMPTY_FORM: SequenceInput = {
  name: '',
  triggerEvent: 'rental.booked',
  delayMinutes: 0,
  content: '',
};

function SequenceForm({
  initial,
  onSave,
  onCancel,
  isLoading,
}: {
  initial: SequenceInput;
  onSave: (data: SequenceInput) => void;
  onCancel: () => void;
  isLoading: boolean;
}): React.JSX.Element {
  const [form, setForm] = useState<SequenceInput>(initial);

  function set<K extends keyof SequenceInput>(k: K, v: SequenceInput[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function insertVar(varKey: string) {
    set('content', form.content + varKey);
  }

  const isBefore = form.delayMinutes < 0;
  const absDelay = Math.abs(form.delayMinutes);
  const delayHours = Math.floor(absDelay / 60);
  const delayMins = absDelay % 60;

  return (
    <div className="space-y-4">
      {/* Nom */}
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">Nom de la séquence</label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="Ex: Message de bienvenue"
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e] focus:ring-2 focus:ring-[#01696e]/20"
        />
      </div>

      {/* Déclencheur */}
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">Déclencheur</label>
        <select
          value={form.triggerEvent}
          onChange={(e) => set('triggerEvent', e.target.value as TriggerEvent)}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]"
        >
          {TRIGGER_OPTIONS.map((t) => (
            <option key={t} value={t}>{TRIGGER_LABELS[t]}</option>
          ))}
        </select>
      </div>

      {/* Délai */}
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          {DELAY_LABELS[form.triggerEvent]}
        </label>
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <input
              type="number"
              max={72}
              value={delayHours}
              onChange={(e) => set('delayMinutes', (isBefore ? -1 : 1) * (parseInt(e.target.value || '0', 10) * 60 + delayMins))}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]"
            />
            <p className="mt-0.5 text-xs text-gray-400">heures</p>
          </div>
          <div className="flex-1">
            <input
              type="number"
              max={59}
              step={5}
              value={delayMins}
              onChange={(e) => set('delayMinutes', (isBefore ? -1 : 1) * (delayHours * 60 + parseInt(e.target.value || '0', 10)))}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]"
            />
            <p className="mt-0.5 text-xs text-gray-400">minutes</p>
          </div>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium mb-0.5">
            <button
              type="button"
              onClick={() => { if (!isBefore && form.delayMinutes !== 0) set('delayMinutes', -form.delayMinutes); }}
              className={`px-3 py-2 transition ${isBefore ? 'bg-[#01696e] text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
            >avant</button>
            <button
              type="button"
              onClick={() => { if (isBefore) set('delayMinutes', -form.delayMinutes); }}
              className={`px-3 py-2 transition ${!isBefore ? 'bg-[#01696e] text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
            >après</button>
          </div>
        </div>
        {form.delayMinutes === 0 && (
          <p className="mt-1 text-xs text-red-500">Le délai doit être non nul</p>
        )}
        {form.delayMinutes !== 0 && (
          <p className="mt-1 text-xs text-[#01696e]">{delayLabel(form.delayMinutes)}</p>
        )}
      </div>

      {/* Contenu / template */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700">Message (template)</label>
        </div>
        <textarea
          value={form.content}
          onChange={(e) => set('content', e.target.value)}
          rows={5}
          placeholder="Bonjour {{driver_name}}, votre {{vehicle}} est prêt..."
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e] focus:ring-2 focus:ring-[#01696e]/20"
        />
        {/* Variables */}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {TEMPLATE_VARS.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => insertVar(v.key)}
              title={v.label}
              className="rounded-md border border-gray-200 px-2 py-0.5 font-mono text-xs text-gray-600 hover:border-[#01696e]/40 hover:text-[#01696e]"
            >
              {v.key}
            </button>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={() => onSave(form)}
          disabled={isLoading || !form.name || !form.content}
          className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white transition disabled:opacity-60"
          style={{ backgroundColor: '#01696e' }}
        >
          {isLoading ? 'Enregistrement...' : 'Enregistrer'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Annuler
        </button>
      </div>
    </div>
  );
}

type LogEntry = { id: string; sequenceId: string; rentalId: string; scheduledAt: string; executedAt: string | null; status: string; rental: { driverName: string; getaroundId: string | null } };

function renderPreview(template: string, vars: Record<string, string>): string {
  return template
    .replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`)
    .replace(/\{(\w+)\}/g, (match, key: string) => vars[key] ?? match);
}

function HistoriqueModal({ seq, onClose }: { seq: Sequence; onClose: () => void }): React.JSX.Element {
  const { data: logs = [], isLoading } = useQuery<LogEntry[]>({
    queryKey: ['sequence-logs', seq.id],
    queryFn: () => sequencesApi.getLogs(seq.id),
    staleTime: 30_000,
  });

  const STATUS_COLOR: Record<string, string> = {
    sent: 'text-green-600',
    pending: 'text-blue-600',
    cancelled: 'text-gray-400',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-900">Historique — {seq.name}</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <div className="max-h-96 overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex justify-center py-8"><div className="h-5 w-5 animate-spin rounded-full border-2 border-t-transparent" style={{ borderColor: '#01696e', borderTopColor: 'transparent' }} /></div>
          ) : logs.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-400">Aucun envoi enregistré</p>
          ) : (
            <div className="space-y-2">
              {logs.map(log => (
                <div key={log.id} className="rounded-lg border border-gray-100 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-800">{log.rental.driverName}</span>
                    <span className={`text-xs font-semibold ${STATUS_COLOR[log.status] ?? 'text-gray-500'}`}>{log.status}</span>
                  </div>
                  <p className="text-xs text-gray-400">
                    Planifié : {format(new Date(log.scheduledAt), 'dd/MM/yyyy HH:mm', { locale: fr })}
                    {log.executedAt && ` · Envoyé : ${format(new Date(log.executedAt), 'HH:mm', { locale: fr })}`}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TesterModal({ seq, onClose }: { seq: Sequence; onClose: () => void }): React.JSX.Element {
  const DEMO_VARS: Record<string, string> = {
    driver_name: 'Marie',
    vehicle: 'Peugeot 208',
    license_plate: 'AB-123-CD',
    licensePlate: 'AB-123-CD',
    start_date: '23/06/2026',
    end_date: '25/06/2026',
    startAt: '23/06/2026 10:00',
    endAt: '25/06/2026 18:00',
    deliveryPoint: 'Parking Mignet',
    pickupInstructions: 'Boîte à clé n°12, code 1234',
    returnInstructions: 'Garer niveau -1, laisser les clés en boîte',
  };

  const preview = renderPreview(seq.content, DEMO_VARS);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-900">Aperçu — {seq.name}</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <div className="p-5 space-y-3">
          <div className="rounded-xl bg-gray-50 p-4">
            <p className="mb-1 text-xs font-medium text-gray-500">Message interpolé (données de test)</p>
            <p className="whitespace-pre-wrap text-sm text-gray-800">{preview}</p>
          </div>
          <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2">
            <p className="text-xs text-blue-700">Simulation uniquement — aucun message n&apos;est envoyé</p>
          </div>
          <p className="text-xs text-gray-400">
            Déclencheur : <strong>{TRIGGER_LABELS[seq.triggerEvent as TriggerEvent]}</strong> · Délai : <strong>{delayLabel(seq.delayMinutes)}</strong>
          </p>
        </div>
      </div>
    </div>
  );
}

function SequenceCard({
  seq,
  onEdit,
}: {
  seq: Sequence;
  onEdit: (seq: Sequence) => void;
}): React.JSX.Element {
  const qc = useQueryClient();
  const [showLogs, setShowLogs] = useState(false);
  const [showTester, setShowTester] = useState(false);

  const toggleMutation = useMutation({
    mutationFn: () => sequencesApi.toggle(seq.id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['sequences'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => sequencesApi.delete(seq.id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['sequences'] }),
  });

  return (
    <>
      {showLogs && <HistoriqueModal seq={seq} onClose={() => setShowLogs(false)} />}
      {showTester && <TesterModal seq={seq} onClose={() => setShowTester(false)} />}
      <div className={`rounded-xl border bg-white p-4 shadow-sm transition ${seq.isActive ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-gray-900">{seq.name}</span>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                {TRIGGER_LABELS[seq.triggerEvent as TriggerEvent]}
              </span>
              <span className="text-xs text-gray-400">{delayLabel(seq.delayMinutes)}</span>
            </div>
            <p className="mt-2 line-clamp-2 text-sm text-gray-500 font-mono">{seq.content}</p>
            <p className="mt-1.5 text-xs text-gray-400">{seq._count.executions} envoi{seq._count.executions !== 1 ? 's' : ''}</p>
          </div>

          {/* Toggle actif */}
          <button
            data-testid={`toggle-sequence-${seq.id}`}
            type="button"
            onClick={() => toggleMutation.mutate()}
            disabled={toggleMutation.isPending}
            className="relative shrink-0"
            title={seq.isActive ? 'Désactiver' : 'Activer'}
          >
            <div className={`h-6 w-11 rounded-full transition-colors ${seq.isActive ? 'bg-[#01696e]' : 'bg-gray-200'}`}>
              <div className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${seq.isActive ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </div>
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 border-t border-gray-100 pt-3">
          <button type="button" onClick={() => onEdit(seq)} className="text-xs font-medium text-gray-500 hover:text-[#01696e]">
            Modifier
          </button>
          <span className="text-gray-200">|</span>
          <button data-testid={`btn-historique-${seq.id}`} type="button" onClick={() => setShowLogs(true)}
            className="text-xs font-medium text-gray-500 hover:text-[#01696e]">
            Historique
          </button>
          <span className="text-gray-200">|</span>
          <button data-testid={`btn-tester-${seq.id}`} type="button" onClick={() => setShowTester(true)}
            className="text-xs font-medium text-gray-500 hover:text-[#01696e]">
            Tester
          </button>
          <span className="text-gray-200">|</span>
          <button type="button" onClick={() => { if (confirm(`Supprimer "${seq.name}" ?`)) deleteMutation.mutate(); }}
            disabled={deleteMutation.isPending} className="text-xs font-medium text-gray-500 hover:text-red-500">
            Supprimer
          </button>
        </div>
      </div>
    </>
  );
}

export default function SequenceListPage(): React.JSX.Element {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Sequence | null>(null);
  const [intervalEdit, setIntervalEdit] = useState<number | null>(null);
  const [intervalSaved, setIntervalSaved] = useState(false);

  const { data: sequences = [], isLoading } = useQuery({
    queryKey: ['sequences'],
    queryFn: sequencesApi.list,
    staleTime: 5 * 60_000,
  });

  const { data: settingsData } = useQuery<{ settings: { minMessageInterval?: number } }>({
    queryKey: ['settings'],
    queryFn: () => api.get<{ settings: { minMessageInterval?: number } }>('/settings').then(r => r.data),
    staleTime: 5 * 60_000,
  });
  const minInterval = intervalEdit ?? settingsData?.settings?.minMessageInterval ?? 60;

  const saveInterval = useMutation({
    mutationFn: (v: number) => api.put('/settings', { minMessageInterval: v }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings'] });
      setIntervalSaved(true);
      setTimeout(() => setIntervalSaved(false), 2000);
    },
  });

  const createMutation = useMutation({
    mutationFn: sequencesApi.create,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sequences'] });
      setShowForm(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<SequenceInput> }) =>
      sequencesApi.update(id, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sequences'] });
      setEditTarget(null);
    },
  });

  const TRIGGER_OPTIONS: TriggerEvent[] = [
    'rental.booked',
    'rental.car_checked_in',
    'rental.car_checked_out',
  ];

  // Grouper par déclencheur
  const grouped = TRIGGER_OPTIONS.reduce<Record<TriggerEvent, Sequence[]>>(
    (acc, event) => {
      acc[event] = sequences.filter((s) => s.triggerEvent === event);
      return acc;
    },
    {} as Record<TriggerEvent, Sequence[]>,
  );

  return (
    <div className="p-4 lg:p-6">
      {/* En-tête */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Séquences de messages</h1>
          <p className="text-sm text-gray-500">
            Messages automatiques envoyés selon les événements de location
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setEditTarget(null); setShowForm(true); }}
          className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm"
          style={{ backgroundColor: '#01696e' }}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Nouvelle séquence
        </button>
      </div>

      {/* Intervalle minimum entre messages */}
      <div className="mb-5 flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
        <label className="text-sm font-medium text-gray-700 whitespace-nowrap" htmlFor="min-message-interval">
          Intervalle minimum entre 2 messages (même locataire)
        </label>
        <input
          id="min-message-interval"
          data-testid="input-min-message-interval"
          type="number"
          min={0}
          max={1440}
          value={minInterval}
          onChange={e => setIntervalEdit(Number(e.target.value))}
          className="w-20 rounded-lg border border-gray-300 px-2 py-1 text-sm text-center"
        />
        <span className="text-xs text-gray-400">minutes</span>
        {intervalEdit !== null && intervalEdit !== (settingsData?.settings?.minMessageInterval ?? 60) && (
          <button
            type="button"
            onClick={() => saveInterval.mutate(minInterval)}
            disabled={saveInterval.isPending}
            className="ml-auto rounded-lg px-3 py-1 text-xs font-semibold text-white"
            style={{ backgroundColor: '#01696e' }}
          >
            {saveInterval.isPending ? '…' : intervalSaved ? '✓ Sauvegardé' : 'Enregistrer'}
          </button>
        )}
      </div>

      {/* Formulaire création */}
      {showForm && !editTarget && (
        <div className="mb-6 rounded-2xl border border-[#01696e]/20 bg-[#01696e]/5 p-5">
          <h2 className="mb-4 text-sm font-semibold text-gray-900">Nouvelle séquence</h2>
          <SequenceForm
            initial={EMPTY_FORM}
            onSave={(data) => createMutation.mutate(data)}
            onCancel={() => setShowForm(false)}
            isLoading={createMutation.isPending}
          />
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div
            className="h-8 w-8 animate-spin rounded-full border-4 border-t-transparent"
            style={{ borderColor: '#01696e', borderTopColor: 'transparent' }}
          />
        </div>
      ) : sequences.length === 0 && !showForm ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="font-medium text-gray-500">Aucune séquence configurée</p>
          <p className="mt-1 text-sm text-gray-400">
            Créez des messages automatiques pour vos locataires.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {TRIGGER_OPTIONS.map((trigger) => {
            const group = grouped[trigger];
            if (group.length === 0) return null;
            return (
              <div key={trigger}>
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  {TRIGGER_LABELS[trigger]}
                </h2>
                <div className="space-y-3">
                  {group.map((seq) =>
                    editTarget?.id === seq.id ? (
                      <div key={seq.id} className="rounded-2xl border border-[#01696e]/20 bg-[#01696e]/5 p-5">
                        <h2 className="mb-4 text-sm font-semibold text-gray-900">Modifier la séquence</h2>
                        <SequenceForm
                          initial={{ name: seq.name, triggerEvent: seq.triggerEvent as TriggerEvent, delayMinutes: seq.delayMinutes, content: seq.content }}
                          onSave={(data) => updateMutation.mutate({ id: seq.id, data })}
                          onCancel={() => setEditTarget(null)}
                          isLoading={updateMutation.isPending}
                        />
                      </div>
                    ) : (
                      <SequenceCard key={seq.id} seq={seq} onEdit={setEditTarget} />
                    ),
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
