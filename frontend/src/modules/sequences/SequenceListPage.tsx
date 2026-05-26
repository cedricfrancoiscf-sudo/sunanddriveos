import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  sequencesApi,
  type Sequence,
  type SequenceInput,
  type TriggerEvent,
  TRIGGER_LABELS,
  TEMPLATE_VARS,
} from './sequencesApi';

function delayLabel(minutes: number): string {
  if (minutes === 0) return 'Immédiatement';
  if (minutes < 60) return `${minutes} min après`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} h après`;
  return `${Math.round(minutes / 1440)} j après`;
}

const TRIGGER_OPTIONS: TriggerEvent[] = [
  'rental.booked',
  'rental.car_checked_in',
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

  const delayHours = Math.floor(form.delayMinutes / 60);
  const delayMins = form.delayMinutes % 60;

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
        <label className="mb-1 block text-sm font-medium text-gray-700">Délai d'envoi</label>
        <div className="flex gap-2">
          <div className="flex-1">
            <input
              type="number"
              min={0}
              value={delayHours}
              onChange={(e) => set('delayMinutes', parseInt(e.target.value || '0', 10) * 60 + delayMins)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]"
            />
            <p className="mt-0.5 text-xs text-gray-400">heures</p>
          </div>
          <div className="flex-1">
            <input
              type="number"
              min={0}
              max={59}
              value={delayMins}
              onChange={(e) => set('delayMinutes', delayHours * 60 + parseInt(e.target.value || '0', 10))}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]"
            />
            <p className="mt-0.5 text-xs text-gray-400">minutes</p>
          </div>
        </div>
        {form.delayMinutes > 0 && (
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

function SequenceCard({
  seq,
  onEdit,
}: {
  seq: Sequence;
  onEdit: (seq: Sequence) => void;
}): React.JSX.Element {
  const qc = useQueryClient();

  const toggleMutation = useMutation({
    mutationFn: () => sequencesApi.toggle(seq.id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['sequences'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => sequencesApi.delete(seq.id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['sequences'] }),
  });

  return (
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
          <p className="mt-1.5 text-xs text-gray-400">{seq._count.executions} exécution{seq._count.executions !== 1 ? 's' : ''}</p>
        </div>

        {/* Toggle actif */}
        <button
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

      <div className="mt-3 flex gap-2 border-t border-gray-100 pt-3">
        <button
          type="button"
          onClick={() => onEdit(seq)}
          className="text-xs font-medium text-gray-500 hover:text-[#01696e]"
        >
          Modifier
        </button>
        <span className="text-gray-200">|</span>
        <button
          type="button"
          onClick={() => {
            if (confirm(`Supprimer "${seq.name}" ?`)) deleteMutation.mutate();
          }}
          disabled={deleteMutation.isPending}
          className="text-xs font-medium text-gray-500 hover:text-red-500"
        >
          Supprimer
        </button>
      </div>
    </div>
  );
}

export default function SequenceListPage(): React.JSX.Element {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Sequence | null>(null);

  const { data: sequences = [], isLoading } = useQuery({
    queryKey: ['sequences'],
    queryFn: sequencesApi.list,
    staleTime: 5 * 60_000,
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
