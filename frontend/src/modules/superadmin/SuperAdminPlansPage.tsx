import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type React from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import saApi, { getSuperAdminUser, clearSuperAdminSession } from './superadminApi';

interface PlanConfig {
  id: string;
  name: string;
  priceMonthly: number;
  priceYearly: number;
  description: string;
  features: string[];
  isActive: boolean;
  updatedAt: string;
}

const PLAN_NAMES = ['starter', 'pro', 'enterprise'] as const;
const PLAN_LABELS: Record<string, string> = {
  starter: 'Starter',
  pro: 'Pro',
  enterprise: 'Enterprise',
};

function SuperAdminGuard({ children }: { children: React.ReactNode }): React.JSX.Element {
  const navigate = useNavigate();
  const token = localStorage.getItem('superadmin_token');
  if (!token) {
    navigate('/superadmin/login', { replace: true });
    return <></>;
  }
  return <>{children}</>;
}

export default function SuperAdminPlansPage(): React.JSX.Element {
  return (
    <SuperAdminGuard>
      <PlansContent />
    </SuperAdminGuard>
  );
}

function PlansContent(): React.JSX.Element {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const currentAdmin = getSuperAdminUser();

  const { data, isLoading } = useQuery<{ plans: PlanConfig[] }>({
    queryKey: ['sa-plans'],
    queryFn: () => saApi.get('/superadmin/plans').then((r) => r.data as { plans: PlanConfig[] }),
  });

  const plans = data?.plans ?? [];

  type RowState = {
    priceMonthly: string;
    priceYearly: string;
    description: string;
    features: string;
  };

  const [rows, setRows] = useState<Record<string, RowState>>({});

  function getRow(plan: PlanConfig): RowState {
    return (
      rows[plan.name] ?? {
        priceMonthly: String(plan.priceMonthly),
        priceYearly: String(plan.priceYearly),
        description: plan.description,
        features: plan.features.join('\n'),
      }
    );
  }

  const savePlan = useMutation({
    mutationFn: ({ name, row }: { name: string; row: RowState }) =>
      saApi.put(`/superadmin/plans/${name}`, {
        priceMonthly: Number.parseFloat(row.priceMonthly) || 0,
        priceYearly: Number.parseFloat(row.priceYearly) || 0,
        description: row.description,
        features: row.features
          .split('\n')
          .map((f) => f.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sa-plans'] });
    },
  });

  function handleLogout(): void {
    clearSuperAdminSession();
    navigate('/superadmin/login');
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      <header className="flex h-14 items-center justify-between border-b border-gray-800 bg-gray-900 px-6">
        <div className="flex items-center gap-3">
          <div
            className="flex h-7 w-7 items-center justify-center rounded-lg"
            style={{ backgroundColor: '#01696e' }}
          >
            <svg
              className="h-4 w-4 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
              />
            </svg>
          </div>
          <button
            type="button"
            onClick={() => navigate('/superadmin')}
            className="text-sm text-gray-400 hover:text-gray-200"
          >
            ← Super Admin
          </button>
          <span className="text-sm font-semibold text-white ml-2">Plans & Tarifs</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">{currentAdmin?.name}</span>
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-400 hover:text-white"
          >
            Déconnexion
          </button>
        </div>
      </header>

      <div className="flex-1 p-6 overflow-y-auto">
        <div className="max-w-3xl mx-auto space-y-5">
          <p className="text-sm text-gray-500">
            Configurez les tarifs et fonctionnalités de chaque plan. Ces informations sont affichées
            aux tenants.
          </p>

          {isLoading ? (
            <div className="flex justify-center py-12">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-t-transparent border-[#01696e]" />
            </div>
          ) : (
            PLAN_NAMES.map((planName) => {
              const plan = plans.find((p) => p.name === planName);
              const row = plan
                ? getRow(plan)
                : { priceMonthly: '0', priceYearly: '0', description: '', features: '' };
              const features = plan?.features ?? [];

              return (
                <div key={planName} className="rounded-xl border border-gray-800 bg-gray-900 p-6">
                  <div className="flex items-center justify-between mb-5">
                    <h3 className="text-lg font-semibold text-white">{PLAN_LABELS[planName]}</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {features.map((f) => (
                        <span
                          key={f}
                          className="rounded-full bg-[#01696e]/20 px-2 py-0.5 text-xs text-[#01696e]"
                        >
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Prix mensuel (€)</label>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={row.priceMonthly}
                        onChange={(e) =>
                          setRows((r) => ({
                            ...r,
                            [planName]: { ...row, priceMonthly: e.target.value },
                          }))
                        }
                        className="w-full rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#01696e]/40"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Prix annuel (€)</label>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={row.priceYearly}
                        onChange={(e) =>
                          setRows((r) => ({
                            ...r,
                            [planName]: { ...row, priceYearly: e.target.value },
                          }))
                        }
                        className="w-full rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#01696e]/40"
                      />
                    </div>
                  </div>

                  <div className="mb-4">
                    <label className="block text-xs text-gray-400 mb-1">Description</label>
                    <input
                      value={row.description}
                      onChange={(e) =>
                        setRows((r) => ({
                          ...r,
                          [planName]: { ...row, description: e.target.value },
                        }))
                      }
                      className="w-full rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#01696e]/40"
                    />
                  </div>

                  <div className="mb-5">
                    <label className="block text-xs text-gray-400 mb-1">
                      Fonctionnalités (une par ligne)
                    </label>
                    <textarea
                      rows={4}
                      value={row.features}
                      onChange={(e) =>
                        setRows((r) => ({ ...r, [planName]: { ...row, features: e.target.value } }))
                      }
                      className="w-full rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#01696e]/40"
                    />
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => savePlan.mutate({ name: planName, row })}
                      disabled={savePlan.isPending}
                      className="rounded-xl px-5 py-2 text-sm font-medium text-white disabled:opacity-60"
                      style={{ backgroundColor: '#01696e' }}
                    >
                      {savePlan.isPending ? 'Sauvegarde...' : 'Sauvegarder'}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
