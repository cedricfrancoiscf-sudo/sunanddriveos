import { useMutation, useQuery } from '@tanstack/react-query';
import { differenceInDays, format } from 'date-fns';
import { fr } from 'date-fns/locale';
import type React from 'react';
import { useState } from 'react';
import { api } from '../../utils/api';

interface PlanInfo {
  name: string;
  priceMonthly: number;
  priceYearly: number;
  description: string;
  features: string[];
}

interface BillingStatus {
  plan: string;
  status: string;
  mode: string;
  trialEndsAt: string | null;
  hasStripe: boolean;
  stripeConfigured: boolean;
  isDemo: boolean;
  priceMonthly: number;
  priceYearly: number;
  planDescription: string;
  planFeatures: string[];
  allPlans: PlanInfo[];
  payments: Array<{ id: string; amountCents: number; processedAt: string; invoicePdfUrl: string | null }>;
}

const PLAN_LABELS: Record<string, string> = { starter: 'Starter', pro: 'Pro', enterprise: 'Enterprise' };
const PLAN_ORDER = ['starter', 'pro', 'enterprise'];

export default function BillingPage(): React.JSX.Element {
  const [portalLoading, setPortalLoading] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState('pro');
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');

  const { data, isLoading } = useQuery<BillingStatus>({
    queryKey: ['billing-status'],
    queryFn: () => api.get<BillingStatus>('/billing/status').then((r) => r.data),
  });

  const trialDaysLeft = data?.trialEndsAt
    ? differenceInDays(new Date(data.trialEndsAt), new Date())
    : null;
  const isOnTrial = trialDaysLeft !== null && trialDaysLeft >= 0;
  const isSuspended = data?.status === 'suspendu';

  async function handlePortal(): Promise<void> {
    setPortalLoading(true);
    try {
      const res = await api.post<{ url: string }>('/billing/portal', {});
      window.location.href = res.data.url;
    } catch {
      setPortalLoading(false);
    }
  }

  const checkoutMutation = useMutation({
    mutationFn: ({ planId, cycle }: { planId: string; cycle: 'monthly' | 'yearly' }) =>
      api.post<{ url: string }>('/billing/create-checkout-session', { planId, billingCycle: cycle }).then(r => r.data),
    onSuccess: (data) => { window.location.href = data.url; },
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" style={{ borderColor: '#01696e', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <h1 className="text-xl font-bold text-gray-900">Abonnement & Facturation</h1>

      {/* Message si Stripe non configuré */}
      {data && !data.stripeConfigured && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <p className="text-sm font-semibold text-amber-800">Abonnement géré directement par Sun and Drive</p>
          <p className="text-sm text-amber-700 mt-1">
            Votre abonnement est géré directement par Sun and Drive. Contactez-nous pour toute question de facturation.
          </p>
          <a href="mailto:contact@sunanddrive.fr"
            className="mt-3 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white"
            style={{ backgroundColor: '#01696e' }}>
            contact@sunanddrive.fr →
          </a>
        </div>
      )}

      {/* Plan actuel */}
      <div className={`rounded-2xl border p-6 shadow-sm ${isSuspended ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white'}`}>
        {isSuspended && (
          <div className="mb-4 rounded-xl bg-red-100 border border-red-200 p-4">
            <p className="text-sm font-semibold text-red-800">Accès suspendu</p>
            <p className="text-sm text-red-700 mt-1">Votre accès a été suspendu. Contactez-nous ou réactivez votre abonnement.</p>
          </div>
        )}
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-sm text-gray-500 mb-1">Plan actuel</p>
            <p className="text-2xl font-bold" style={{ color: '#01696e' }}>
              {PLAN_LABELS[data?.plan ?? 'starter'] ?? data?.plan ?? 'Starter'}
            </p>
            {(data?.priceMonthly ?? 0) > 0 && (
              <p className="text-sm text-gray-500 mt-1">
                {(data?.priceMonthly ?? 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}/mois
                {(data?.priceYearly ?? 0) > 0 && ` · ${(data?.priceYearly ?? 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}/an`}
              </p>
            )}
            {data?.planDescription && <p className="text-xs text-gray-400 mt-1">{data.planDescription}</p>}
          </div>
          <div className="flex flex-col items-end gap-2">
            {isOnTrial && (
              <span className="rounded-full bg-orange-100 px-3 py-1 text-sm font-medium text-orange-700">
                Trial — {trialDaysLeft}j restants
              </span>
            )}
            {data?.mode === 'forced' && (
              <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">Forcé</span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {data?.hasStripe && (
            <button
              type="button"
              onClick={() => void handlePortal()}
              disabled={portalLoading}
              className="rounded-xl px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
              style={{ backgroundColor: '#01696e' }}
            >
              {portalLoading ? 'Redirection...' : 'Gérer mon abonnement'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowUpgrade(true)}
            className="rounded-xl border border-gray-300 px-5 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Changer de plan
          </button>
        </div>
      </div>

      {/* Modal changement de plan */}
      {showUpgrade && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <h2 className="font-semibold text-gray-900">Changer de plan</h2>
              <button type="button" onClick={() => setShowUpgrade(false)} className="text-gray-400 hover:text-gray-700">✕</button>
            </div>
            <div className="p-6 space-y-4">
              {/* Cycle de facturation */}
              <div className="flex gap-1 rounded-lg border border-gray-200 bg-gray-50 p-0.5 w-fit">
                {(['monthly', 'yearly'] as const).map(c => (
                  <button key={c} type="button"
                    onClick={() => setBillingCycle(c)}
                    className={`rounded px-4 py-1.5 text-sm font-medium transition ${billingCycle === c ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
                    {c === 'monthly' ? 'Mensuel' : 'Annuel'}
                    {c === 'yearly' && <span className="ml-1 text-xs text-emerald-600">-17%</span>}
                  </button>
                ))}
              </div>

              {/* Plans */}
              <div className="space-y-3">
                {PLAN_ORDER.map(planName => {
                  const planInfo = data?.allPlans.find(p => p.name === planName);
                  const price = billingCycle === 'yearly' ? (planInfo?.priceYearly ?? 0) : (planInfo?.priceMonthly ?? 0);
                  const isCurrent = data?.plan === planName;
                  return (
                    <div key={planName}
                      onClick={() => setSelectedPlan(planName)}
                      className={`cursor-pointer rounded-xl border p-4 transition ${selectedPlan === planName ? 'border-[#01696e] bg-[#01696e]/5' : 'border-gray-200 hover:border-gray-300'} ${isCurrent ? 'opacity-60' : ''}`}>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-gray-900">{PLAN_LABELS[planName]}</p>
                          {planInfo?.description && <p className="text-xs text-gray-500 mt-0.5">{planInfo.description}</p>}
                        </div>
                        <p className="text-sm font-bold text-gray-900">
                          {price > 0 ? `${price.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}/${billingCycle === 'yearly' ? 'an' : 'mois'}` : 'Sur devis'}
                        </p>
                      </div>
                      {isCurrent && <p className="text-xs text-gray-400 mt-1">Plan actuel</p>}
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                disabled={checkoutMutation.isPending || selectedPlan === data?.plan}
                onClick={() => checkoutMutation.mutate({ planId: selectedPlan, cycle: billingCycle })}
                className="w-full rounded-xl py-3 text-sm font-semibold text-white disabled:opacity-60"
                style={{ backgroundColor: '#01696e' }}
              >
                {checkoutMutation.isPending ? 'Redirection...' : `Passer au plan ${PLAN_LABELS[selectedPlan]}`}
              </button>
              {checkoutMutation.isError && (
                <p className="text-xs text-red-600 text-center">Prix non configuré — contactez le support</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Historique paiements */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Historique des paiements</h2>
        {(data?.payments ?? []).length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">Aucun paiement enregistré</p>
        ) : (
          <div className="space-y-2">
            {(data?.payments ?? []).map((p) => (
              <div key={p.id} className="flex items-center justify-between text-sm py-2 border-b border-gray-100 last:border-0">
                <div>
                  <span className="text-gray-900 font-medium">Paiement</span>
                  {p.amountCents > 0 && (
                    <span className="ml-2 text-gray-500">
                      {(p.amountCents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-gray-400 text-xs">
                    {format(new Date(p.processedAt), 'dd MMM yyyy', { locale: fr })}
                  </span>
                  {p.invoicePdfUrl && (
                    <a href={p.invoicePdfUrl} target="_blank" rel="noreferrer"
                      className="text-xs font-medium text-[#01696e] hover:underline">
                      PDF
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
