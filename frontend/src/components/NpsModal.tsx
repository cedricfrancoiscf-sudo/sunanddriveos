import { useMutation, useQuery } from '@tanstack/react-query';
import type React from 'react';
import { useState } from 'react';
import { api } from '../utils/api';

interface NpsSettings {
  intervalDays: number;
  lastNpsAt: string | null;
}

function shouldShowNps(settings: NpsSettings): boolean {
  if (!settings.lastNpsAt) return true;
  const lastMs = new Date(settings.lastNpsAt).getTime();
  const intervalMs = settings.intervalDays * 86_400_000;
  return Date.now() - lastMs >= intervalMs;
}

export function useNpsModal(): { show: boolean; dismiss: () => void } {
  const [dismissed, setDismissed] = useState(false);

  const { data } = useQuery<NpsSettings>({
    queryKey: ['nps-settings'],
    queryFn: () => api.get<NpsSettings>('/nps/settings').then(r => r.data),
    staleTime: 60 * 60_000,
  });

  const show = !dismissed && !!data && shouldShowNps(data);
  return { show, dismiss: () => setDismissed(true) };
}

export default function NpsModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const submit = useMutation({
    mutationFn: (data: { score: number; comment?: string }) =>
      api.post('/nps', data),
    onSuccess: () => setSubmitted(true),
  });

  if (submitted) {
    return (
      <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/30 p-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl text-center">
          <div className="text-4xl mb-3">🙏</div>
          <p className="font-semibold text-gray-900">Merci pour votre retour !</p>
          <p className="text-sm text-gray-500 mt-1">Votre avis nous aide à améliorer SunanddriveOS.</p>
          <button type="button" onClick={onClose}
            className="mt-5 rounded-xl px-6 py-2.5 text-sm font-semibold text-white"
            style={{ backgroundColor: '#01696e' }}>
            Fermer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="font-semibold text-gray-900 text-base">Votre avis compte</p>
            <p className="text-sm text-gray-500 mt-1">
              De 0 à 10, dans quelle mesure recommanderiez-vous SunanddriveOS à un autre exploitant Getaround ?
            </p>
          </div>
          <button type="button" onClick={onClose} className="ml-3 text-gray-400 hover:text-gray-600 text-lg">✕</button>
        </div>

        {/* Score buttons */}
        <div className="flex gap-1 flex-wrap justify-center my-5">
          {Array.from({ length: 11 }, (_, i) => i).map(n => (
            <button
              key={n}
              type="button"
              onClick={() => setScore(n)}
              className={`w-9 h-9 rounded-lg text-sm font-semibold transition border ${
                score === n
                  ? 'text-white border-[#01696e]'
                  : 'bg-gray-50 border-gray-200 text-gray-700 hover:border-[#01696e] hover:text-[#01696e]'
              }`}
              style={score === n ? { backgroundColor: '#01696e' } : {}}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="flex justify-between text-xs text-gray-400 -mt-2 mb-4 px-1">
          <span>Pas du tout</span>
          <span>Très probable</span>
        </div>

        {/* Commentaire optionnel */}
        <textarea
          rows={3}
          value={comment}
          onChange={e => setComment(e.target.value)}
          placeholder="Un commentaire (optionnel)..."
          className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 outline-none focus:border-[#01696e] focus:ring-2 focus:ring-[#01696e]/20 resize-none"
        />

        <div className="flex gap-3 mt-4">
          <button type="button" onClick={onClose}
            className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50">
            Plus tard
          </button>
          <button
            type="button"
            disabled={score === null || submit.isPending}
            onClick={() => { if (score !== null) { const c = comment.trim(); submit.mutate({ score, ...(c ? { comment: c } : {}) }); } }}
            className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: '#01696e' }}
          >
            {submit.isPending ? 'Envoi...' : 'Envoyer'}
          </button>
        </div>
      </div>
    </div>
  );
}
