import { useQuery } from '@tanstack/react-query';
import { differenceInDays, format } from 'date-fns';
import { fr } from 'date-fns/locale';
import type React from 'react';
import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { api } from '../../utils/api';

interface BillingEvent {
  id: string;
  type: string;
  stripeEventId: string;
  processedAt: string;
  data: Record<string, unknown>;
}

export default function BillingPage(): React.JSX.Element {
  const { user } = useAuth();
  const [portalLoading, setPortalLoading] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['billing-events'],
    queryFn: () =>
      api.get<{ billingEvents: BillingEvent[] }>('/billing/events').then((r) => r.data),
  });

  const payments = (data?.billingEvents ?? []).filter(
    (e) => e.type === 'invoice.payment_succeeded',
  );

  const trialDaysLeft = user?.trialEndsAt
    ? differenceInDays(new Date(user.trialEndsAt), new Date())
    : null;
  const isOnTrial = trialDaysLeft !== null && trialDaysLeft >= 0;

  async function handlePortal(): Promise<void> {
    setPortalLoading(true);
    try {
      const res = await api.post<{ url: string }>('/billing/portal', {});
      window.location.href = res.data.url;
    } catch {
      setPortalLoading(false);
    }
  }

  const PLAN_LABELS: Record<string, string> = {
    starter: 'Starter',
    pro: 'Pro',
    enterprise: 'Enterprise',
  };

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <h1 className="text-xl font-bold text-gray-900">Abonnement & Facturation</h1>

      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm text-gray-500 mb-1">Plan actuel</p>
            <p className="text-2xl font-bold" style={{ color: '#01696e' }}>
              {PLAN_LABELS[user?.plan ?? 'starter'] ?? user?.plan ?? 'Starter'}
            </p>
          </div>
          {isOnTrial && (
            <span className="rounded-full bg-orange-100 px-3 py-1 text-sm font-medium text-orange-700">
              Trial — {trialDaysLeft}j restants
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void handlePortal()}
          disabled={portalLoading}
          className="rounded-xl px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          style={{ backgroundColor: '#01696e' }}
        >
          {portalLoading ? 'Redirection...' : 'Gérer mon abonnement'}
        </button>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Historique des paiements</h2>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <div
              className="h-5 w-5 animate-spin rounded-full border-2 border-t-transparent"
              style={{ borderColor: '#01696e', borderTopColor: 'transparent' }}
            />
          </div>
        ) : payments.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">Aucun paiement enregistré</p>
        ) : (
          <div className="space-y-2">
            {payments.map((p) => {
              const amount = (p.data as { amount_paid?: number })?.amount_paid;
              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between text-sm py-2 border-b border-gray-100 last:border-0"
                >
                  <div>
                    <span className="text-gray-900 font-medium">Paiement réussi</span>
                    {amount !== undefined && (
                      <span className="ml-2 text-gray-500">
                        {(amount / 100).toLocaleString('fr-FR', {
                          style: 'currency',
                          currency: 'EUR',
                        })}
                      </span>
                    )}
                  </div>
                  <span className="text-gray-400 text-xs">
                    {format(new Date(p.processedAt), 'dd MMMM yyyy', { locale: fr })}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
