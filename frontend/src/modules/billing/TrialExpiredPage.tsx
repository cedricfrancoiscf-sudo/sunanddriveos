import React, { useState } from 'react';
import { api } from '../../utils/api';

const PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    price: '29€/mois',
    features: ['Sync Getaround', 'Planning', 'Messages', 'Documents', 'Locations'],
    highlight: false,
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '59€/mois',
    features: ['Tout Starter +', 'Séquences automatiques', 'IA & suggestions', 'Scoring', 'Exports', 'PWA mobile'],
    highlight: true,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 'Sur devis',
    features: ['Tout Pro +', 'Multi-carkeepers', 'Slack', 'API publique', 'Support prioritaire'],
    highlight: false,
  },
] as const;

export default function TrialExpiredPage(): React.JSX.Element {
  const [loading, setLoading] = useState<string | null>(null);

  async function handleUpgrade(plan: string): Promise<void> {
    setLoading(plan);
    try {
      const res = await api.post<{ url: string }>('/billing/checkout', { plan });
      window.location.href = res.data.url;
    } catch {
      setLoading(null);
    }
  }

  async function handlePortal(): Promise<void> {
    setLoading('portal');
    try {
      const res = await api.post<{ url: string }>('/billing/portal', {});
      window.location.href = res.data.url;
    } catch {
      setLoading(null);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
      <div className="mb-8 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl mx-auto" style={{ backgroundColor: '#01696e' }}>
          <span className="text-2xl font-bold text-white">S</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Votre période d'essai est terminée</h1>
        <p className="mt-2 text-gray-500">Choisissez un plan pour continuer à utiliser SunanddriveOS</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3 w-full max-w-4xl">
        {PLANS.map(plan => (
          <div key={plan.id}
            className={`rounded-2xl border bg-white p-6 shadow-sm flex flex-col ${plan.highlight ? 'border-[#01696e] ring-2 ring-[#01696e]' : 'border-gray-200'}`}>
            {plan.highlight && (
              <span className="mb-3 inline-block self-start rounded-full px-3 py-0.5 text-xs font-medium text-white" style={{ backgroundColor: '#01696e' }}>
                Recommandé
              </span>
            )}
            <h2 className="text-lg font-bold text-gray-900">{plan.name}</h2>
            <p className="mt-1 text-2xl font-bold" style={{ color: '#01696e' }}>{plan.price}</p>
            <ul className="mt-4 space-y-2 flex-1">
              {plan.features.map(f => (
                <li key={f} className="flex items-center gap-2 text-sm text-gray-600">
                  <span style={{ color: '#01696e' }}>✓</span> {f}
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => void handleUpgrade(plan.id)}
              disabled={loading === plan.id}
              className="mt-6 w-full rounded-xl py-2.5 text-sm font-semibold text-white transition disabled:opacity-60"
              style={{ backgroundColor: '#01696e' }}
            >
              {loading === plan.id ? 'Redirection...' : `Choisir ${plan.name}`}
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => void handlePortal()}
        disabled={loading === 'portal'}
        className="mt-6 text-sm text-gray-500 underline hover:text-gray-700 disabled:opacity-50"
      >
        {loading === 'portal' ? 'Redirection...' : 'Gérer mon abonnement existant'}
      </button>
    </div>
  );
}
