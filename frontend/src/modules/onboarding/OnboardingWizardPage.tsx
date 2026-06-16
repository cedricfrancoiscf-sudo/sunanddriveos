import { useQuery } from '@tanstack/react-query';
import type React from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../utils/api';

interface WizardCheck {
  id: string;
  label: string;
  completed: boolean;
}

const PRIMARY = '#01696e';

function StepIndicator({ current, total }: { current: number; total: number }): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 mb-6">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`h-1.5 rounded-full flex-1 transition-colors ${i < current ? 'opacity-100' : 'opacity-30'}`}
          style={{ backgroundColor: PRIMARY }}
        />
      ))}
      <span className="text-xs text-gray-400 ml-1">
        {current}/{total}
      </span>
    </div>
  );
}

export default function OnboardingWizardPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const TOTAL = 5;

  const [companyForm, setCompanyForm] = useState({
    siret: '',
    managerName: '',
    phone: '',
    contactEmail: '',
    address: '',
    city: '',
    postalCode: '',
  });
  const [apiKey, setApiKey] = useState('');
  const [apiKeyStatus, setApiKeyStatus] = useState<'idle' | 'testing' | 'valid' | 'invalid'>(
    'idle',
  );
  const [messagingForm, setMessagingForm] = useState({
    tone: 'professionnel',
    assistantName: 'SunBot',
    defaultMode: 'auto',
  });
  const [saving, setSaving] = useState(false);

  const { data: statusData, refetch: refetchStatus } = useQuery<{
    checks: WizardCheck[];
    completedCount: number;
    totalCount: number;
  }>({
    queryKey: ['wizard-status'],
    queryFn: () =>
      api
        .get('/onboarding/wizard-status')
        .then(
          (r) => r.data as { checks: WizardCheck[]; completedCount: number; totalCount: number },
        ),
    enabled: step === 5,
  });

  async function saveCompanyInfo(): Promise<void> {
    setSaving(true);
    try {
      await api.patch('/onboarding/company-info', companyForm);
    } catch {
      /* non bloquant */
    } finally {
      setSaving(false);
    }
  }

  async function testApiKey(): Promise<void> {
    setApiKeyStatus('testing');
    try {
      const res = await api.post<{ valid: boolean }>('/onboarding/test-api-key', { apiKey });
      setApiKeyStatus(res.data.valid ? 'valid' : 'invalid');
    } catch {
      setApiKeyStatus('invalid');
    }
  }

  async function saveMessagingPrefs(): Promise<void> {
    setSaving(true);
    try {
      await api.patch('/onboarding/messaging-prefs', messagingForm);
    } catch {
      /* non bloquant */
    } finally {
      setSaving(false);
    }
  }

  async function complete(): Promise<void> {
    setSaving(true);
    try {
      await api.patch('/onboarding/complete', {});
      navigate('/dashboard');
    } catch {
      navigate('/dashboard');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-lg p-8">
        {/* Étape 1 — Bienvenue */}
        {step === 1 && (
          <div className="text-center">
            <StepIndicator current={1} total={TOTAL} />
            <div
              className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl mx-auto"
              style={{ backgroundColor: PRIMARY }}
            >
              <span className="text-2xl font-bold text-white">S</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-3">Bienvenue sur SunanddriveOS</h1>
            <p className="text-gray-500 mb-8">
              Configurons votre espace en quelques étapes. Cela prendra moins de 5 minutes.
            </p>
            <button
              type="button"
              onClick={() => setStep(2)}
              className="w-full rounded-xl py-3 text-sm font-semibold text-white"
              style={{ backgroundColor: PRIMARY }}
            >
              Commencer
            </button>
          </div>
        )}

        {/* Étape 2 — Société */}
        {step === 2 && (
          <div>
            <StepIndicator current={2} total={TOTAL} />
            <h2 className="text-xl font-bold text-gray-900 mb-1">Votre société</h2>
            <p className="text-sm text-gray-500 mb-6">
              Ces informations nous permettent de personnaliser votre expérience.
            </p>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">SIRET</label>
                  <input
                    value={companyForm.siret}
                    onChange={(e) => setCompanyForm((f) => ({ ...f, siret: e.target.value }))}
                    placeholder="12345678901234"
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#01696e]/30"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Nom du gérant</label>
                  <input
                    value={companyForm.managerName}
                    onChange={(e) => setCompanyForm((f) => ({ ...f, managerName: e.target.value }))}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#01696e]/30"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Téléphone</label>
                  <input
                    type="tel"
                    value={companyForm.phone}
                    onChange={(e) => setCompanyForm((f) => ({ ...f, phone: e.target.value }))}
                    placeholder="+33 6 00 00 00 00"
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#01696e]/30"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Email de contact</label>
                  <input
                    type="email"
                    value={companyForm.contactEmail}
                    onChange={(e) =>
                      setCompanyForm((f) => ({ ...f, contactEmail: e.target.value }))
                    }
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#01696e]/30"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Adresse</label>
                <input
                  value={companyForm.address}
                  onChange={(e) => setCompanyForm((f) => ({ ...f, address: e.target.value }))}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#01696e]/30"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs text-gray-600 mb-1">Ville</label>
                  <input
                    value={companyForm.city}
                    onChange={(e) => setCompanyForm((f) => ({ ...f, city: e.target.value }))}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#01696e]/30"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Code postal</label>
                  <input
                    value={companyForm.postalCode}
                    onChange={(e) => setCompanyForm((f) => ({ ...f, postalCode: e.target.value }))}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#01696e]/30"
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                type="button"
                onClick={() => setStep(3)}
                className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm text-gray-500 hover:bg-gray-50"
              >
                Ignorer
              </button>
              <button
                type="button"
                onClick={async () => {
                  await saveCompanyInfo();
                  setStep(3);
                }}
                disabled={saving}
                className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                style={{ backgroundColor: PRIMARY }}
              >
                {saving ? 'Enregistrement...' : 'Suivant'}
              </button>
            </div>
          </div>
        )}

        {/* Étape 3 — Clé API Getaround */}
        {step === 3 && (
          <div>
            <StepIndicator current={3} total={TOTAL} />
            <h2 className="text-xl font-bold text-gray-900 mb-1">Clé API Getaround</h2>
            <p className="text-sm text-gray-500 mb-6">
              Connectez votre compte Getaround pour synchroniser votre flotte automatiquement.
            </p>
            <div className="mb-4">
              <label className="block text-xs text-gray-600 mb-1">Clé API Getaround</label>
              <input
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setApiKeyStatus('idle');
                }}
                placeholder="ga_live_..."
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#01696e]/30"
              />
              {apiKeyStatus === 'valid' && (
                <p className="mt-1.5 text-xs text-emerald-600">Connexion réussie</p>
              )}
              {apiKeyStatus === 'invalid' && (
                <p className="mt-1.5 text-xs text-red-500">Clé invalide ou connexion impossible</p>
              )}
            </div>
            {apiKey && apiKeyStatus !== 'valid' && (
              <button
                type="button"
                onClick={() => void testApiKey()}
                disabled={apiKeyStatus === 'testing'}
                className="w-full mb-4 rounded-xl border py-2 text-sm font-medium disabled:opacity-60"
                style={{ borderColor: PRIMARY, color: PRIMARY }}
              >
                {apiKeyStatus === 'testing' ? 'Test en cours...' : 'Tester la connexion'}
              </button>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep(4)}
                className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm text-gray-500 hover:bg-gray-50"
              >
                Ignorer
              </button>
              <button
                type="button"
                onClick={() => setStep(4)}
                className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white"
                style={{ backgroundColor: PRIMARY }}
              >
                Continuer
              </button>
            </div>
          </div>
        )}

        {/* Étape 4 — Préférences messagerie */}
        {step === 4 && (
          <div>
            <StepIndicator current={4} total={TOTAL} />
            <h2 className="text-xl font-bold text-gray-900 mb-1">Préférences messagerie</h2>
            <p className="text-sm text-gray-500 mb-6">
              Personnalisez le comportement de votre assistant.
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Ton des messages</label>
                <select
                  value={messagingForm.tone}
                  onChange={(e) => setMessagingForm((f) => ({ ...f, tone: e.target.value }))}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#01696e]/30"
                >
                  <option value="professionnel">Professionnel</option>
                  <option value="amical">Amical</option>
                  <option value="formel">Formel</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Nom de l'assistant</label>
                <input
                  value={messagingForm.assistantName}
                  onChange={(e) =>
                    setMessagingForm((f) => ({ ...f, assistantName: e.target.value }))
                  }
                  placeholder="SunBot"
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#01696e]/30"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Mode par défaut</label>
                <select
                  value={messagingForm.defaultMode}
                  onChange={(e) => setMessagingForm((f) => ({ ...f, defaultMode: e.target.value }))}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#01696e]/30"
                >
                  <option value="auto">Automatique</option>
                  <option value="manuel">Manuel</option>
                  <option value="suggestion">Suggestion seulement</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                type="button"
                onClick={() => setStep(5)}
                className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm text-gray-500 hover:bg-gray-50"
              >
                Ignorer
              </button>
              <button
                type="button"
                onClick={async () => {
                  await saveMessagingPrefs();
                  await refetchStatus();
                  setStep(5);
                }}
                disabled={saving}
                className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                style={{ backgroundColor: PRIMARY }}
              >
                {saving ? 'Enregistrement...' : 'Suivant'}
              </button>
            </div>
          </div>
        )}

        {/* Étape 5 — Checklist */}
        {step === 5 && (
          <div>
            <StepIndicator current={5} total={TOTAL} />
            <h2 className="text-xl font-bold text-gray-900 mb-1">Votre espace est prêt</h2>
            <p className="text-sm text-gray-500 mb-6">
              {statusData
                ? `${statusData.completedCount}/${statusData.totalCount} éléments configurés`
                : 'Vérification en cours...'}
            </p>
            {statusData && (
              <div className="space-y-2 mb-6">
                {statusData.checks.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center gap-3 rounded-xl border border-gray-100 px-4 py-3"
                  >
                    <div
                      className={`h-5 w-5 rounded-full flex items-center justify-center shrink-0 ${c.completed ? 'bg-emerald-100' : 'bg-gray-100'}`}
                    >
                      {c.completed ? (
                        <svg
                          className="h-3 w-3 text-emerald-600"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={3}
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      ) : (
                        <div className="h-2 w-2 rounded-full bg-gray-300" />
                      )}
                    </div>
                    <span className={`text-sm ${c.completed ? 'text-gray-900' : 'text-gray-400'}`}>
                      {c.label}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => void complete()}
              disabled={saving}
              className="w-full rounded-xl py-3 text-sm font-semibold text-white disabled:opacity-60"
              style={{ backgroundColor: PRIMARY }}
            >
              {saving ? 'Chargement...' : 'Aller au tableau de bord'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
