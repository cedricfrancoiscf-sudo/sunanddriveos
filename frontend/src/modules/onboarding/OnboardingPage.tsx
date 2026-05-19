import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../utils/api';

interface OnboardingStep {
  id: string;
  label: string;
  description: string;
  link: string;
  completed: boolean;
}

interface OnboardingProgress {
  steps: OnboardingStep[];
  completedCount: number;
  totalCount: number;
  progressPercent: number;
  allDone: boolean;
  dismissed: boolean;
}

const STEP_ICONS: Record<string, string> = {
  company_settings:    'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
  getaround_connected: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1',
  vehicles_synced:     'M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0',
  team_invited:        'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z',
  sequences_configured:'M4 6h16M4 10h16M4 14h16M4 18h16',
  first_rental:        'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
};

export default function OnboardingPage(): React.JSX.Element {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<OnboardingProgress>({
    queryKey: ['onboarding-progress'],
    queryFn: () => api.get('/onboarding/progress').then(r => r.data as OnboardingProgress),
  });

  const dismiss = useMutation({
    mutationFn: () => api.post('/onboarding/dismiss'),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['onboarding-progress'] });
      navigate('/dashboard');
    },
  });

  if (isLoading || !data) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" style={{ borderColor: '#01696e', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  const { steps, completedCount, totalCount, progressPercent, allDone } = data;

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto">
      {/* En-tête */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: '#01696e' }}>
            <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Mise en route</h1>
            <p className="text-sm text-gray-500">{completedCount}/{totalCount} étapes complétées</p>
          </div>
        </div>

        {/* Barre de progression */}
        <div className="mt-4 overflow-hidden rounded-full bg-gray-100 h-2.5">
          <div
            className="h-2.5 rounded-full transition-all duration-500"
            style={{ width: `${progressPercent}%`, backgroundColor: '#01696e' }}
          />
        </div>
        <div className="mt-1.5 flex justify-between text-xs text-gray-400">
          <span>0%</span>
          <span className="font-medium" style={{ color: '#01696e' }}>{progressPercent}%</span>
          <span>100%</span>
        </div>
      </div>

      {/* Message succès */}
      {allDone && (
        <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center">
          <p className="text-2xl mb-1">🎉</p>
          <p className="font-bold text-emerald-800">Configuration terminée !</p>
          <p className="text-sm text-emerald-600 mt-1">
            SunanddriveOS est entièrement configuré. Vous pouvez maintenant utiliser toutes les fonctionnalités.
          </p>
        </div>
      )}

      {/* Liste des étapes */}
      <div className="space-y-3">
        {steps.map((step, idx) => (
          <div
            key={step.id}
            className={`rounded-2xl border p-5 transition-all ${
              step.completed
                ? 'border-emerald-200 bg-emerald-50/50'
                : 'border-gray-200 bg-white hover:border-[#01696e]/30 hover:shadow-sm'
            }`}
          >
            <div className="flex items-start gap-4">
              {/* Numéro / Checkmark */}
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                step.completed ? 'bg-emerald-500' : 'bg-gray-100'
              }`}>
                {step.completed ? (
                  <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={STEP_ICONS[step.id] ?? 'M12 4v16m8-8H4'} />
                  </svg>
                )}
              </div>

              {/* Contenu */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-3">
                  <p className={`font-semibold ${step.completed ? 'text-emerald-700 line-through decoration-emerald-400' : 'text-gray-900'}`}>
                    {step.label}
                  </p>
                  <span className="text-xs text-gray-300 shrink-0">Étape {idx + 1}</span>
                </div>
                <p className={`text-sm mt-0.5 ${step.completed ? 'text-emerald-600' : 'text-gray-500'}`}>
                  {step.description}
                </p>
              </div>

              {/* Bouton action */}
              {!step.completed && (
                <Link
                  to={step.link}
                  className="shrink-0 flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-white"
                  style={{ backgroundColor: '#01696e' }}
                >
                  Configurer
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Actions bas de page */}
      <div className="mt-8 flex items-center justify-between">
        <Link to="/dashboard" className="text-sm text-gray-400 hover:text-gray-600">
          ← Retour au tableau de bord
        </Link>
        {!allDone && (
          <button
            type="button"
            onClick={() => dismiss.mutate()}
            disabled={dismiss.isPending}
            className="text-sm text-gray-400 hover:text-gray-600 underline underline-offset-2"
          >
            Ne plus afficher
          </button>
        )}
        {allDone && (
          <Link
            to="/dashboard"
            className="rounded-xl px-5 py-2.5 text-sm font-medium text-white"
            style={{ backgroundColor: '#01696e' }}
          >
            Aller au tableau de bord
          </Link>
        )}
      </div>
    </div>
  );
}
