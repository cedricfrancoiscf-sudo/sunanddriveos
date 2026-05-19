import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../utils/api';
import { getaroundSyncApi, type GetaroundAccount } from '../vehicles/vehiclesApi';

interface CompanySettings {
  id: string;
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
  logoUrl: string | null;
  aiModeCarSeat: string;
  aiModeIncident: string;
  aiModeGeneral: string;
  aiTone: string;
}

const EMPTY_ACCOUNT = { name: '', apiKey: '' };

function fmtRelative(iso: string | null): string {
  if (!iso) return 'jamais';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'il y a < 1 min';
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h}h`;
  return `il y a ${Math.floor(h / 24)}j`;
}

function GetaroundSection(): React.JSX.Element {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_ACCOUNT);
  const [editKeyId, setEditKeyId] = useState<string | null>(null);
  const [newKey, setNewKey] = useState('');
  const [syncMsg, setSyncMsg] = useState<Record<string, string>>({});

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['getaround-accounts'],
    queryFn: getaroundSyncApi.listAccounts,
  });

  const createMutation = useMutation({
    mutationFn: () => getaroundSyncApi.createAccount(form.name, form.apiKey),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['getaround-accounts'] });
      void qc.invalidateQueries({ queryKey: ['onboarding-progress'] });
      setShowForm(false);
      setForm(EMPTY_ACCOUNT);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => getaroundSyncApi.deleteAccount(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['getaround-accounts'] });
      void qc.invalidateQueries({ queryKey: ['onboarding-progress'] });
    },
  });

  const updateKeyMutation = useMutation({
    mutationFn: ({ id, key }: { id: string; key: string }) => getaroundSyncApi.updateAccountKey(id, key),
    onSuccess: () => { setEditKeyId(null); setNewKey(''); },
  });

  const syncVehiclesMutation = useMutation({
    mutationFn: (id: string) => getaroundSyncApi.syncAccount(id),
    onSuccess: (result, id) => {
      void qc.invalidateQueries({ queryKey: ['vehicles'] });
      void qc.invalidateQueries({ queryKey: ['getaround-accounts'] });
      void qc.invalidateQueries({ queryKey: ['onboarding-progress'] });
      setSyncMsg(prev => ({ ...prev, [`v-${id}`]: `+${result.created} créés, ${result.updated} mis à jour` }));
      setTimeout(() => setSyncMsg(prev => { const n = { ...prev }; delete n[`v-${id}`]; return n; }), 4000);
    },
  });

  const syncRentalsMutation = useMutation({
    mutationFn: (id: string) => getaroundSyncApi.syncRentals(id),
    onSuccess: (result, id) => {
      void qc.invalidateQueries({ queryKey: ['onboarding-progress'] });
      setSyncMsg(prev => ({ ...prev, [`r-${id}`]: `Locations : +${result.created}, ${result.updated} mises à jour` }));
      setTimeout(() => setSyncMsg(prev => { const n = { ...prev }; delete n[`r-${id}`]; return n; }), 4000);
    },
  });

  const syncAllMutation = useMutation({
    mutationFn: getaroundSyncApi.syncAll,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['vehicles'] });
      void qc.invalidateQueries({ queryKey: ['getaround-accounts'] });
      void qc.invalidateQueries({ queryKey: ['onboarding-progress'] });
    },
  });

  const isSyncing = syncVehiclesMutation.isPending || syncRentalsMutation.isPending || syncAllMutation.isPending;

  return (
    <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Comptes Getaround</h2>
          <p className="text-xs text-gray-400 mt-0.5">Clés API pour la synchronisation de votre flotte</p>
        </div>
        <div className="flex items-center gap-2">
          {accounts.length > 1 && (
            <button type="button" onClick={() => syncAllMutation.mutate()} disabled={isSyncing}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40">
              {syncAllMutation.isPending ? 'Sync...' : 'Sync tout'}
            </button>
          )}
          <button type="button" onClick={() => { setShowForm(true); setForm(EMPTY_ACCOUNT); }}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-white"
            style={{ backgroundColor: '#01696e' }}>
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            Ajouter un compte
          </button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={e => { e.preventDefault(); createMutation.mutate(); }}
          className="rounded-xl border border-[#01696e]/20 bg-[#01696e]/5 p-4 space-y-3">
          <h3 className="text-xs font-semibold text-gray-700">Nouveau compte Getaround</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Nom du compte *</label>
              <input required type="text" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#01696e]"
                placeholder="Principal, Véhicules pro..." />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Clé API Getaround *</label>
              <input required type="password" value={form.apiKey}
                onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-mono outline-none focus:border-[#01696e]"
                placeholder="••••••••••••••••" />
            </div>
          </div>
          {createMutation.isError && (
            <p className="text-xs text-red-600">Erreur : vérifiez la clé API et réessayez.</p>
          )}
          <div className="flex gap-2">
            <button type="submit" disabled={createMutation.isPending}
              className="rounded-xl px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
              style={{ backgroundColor: '#01696e' }}>
              {createMutation.isPending ? 'Connexion...' : 'Connecter'}
            </button>
            <button type="button" onClick={() => setShowForm(false)}
              className="rounded-xl border border-gray-200 px-4 py-2 text-xs text-gray-700 hover:bg-gray-50">
              Annuler
            </button>
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="flex justify-center py-6">
          <div className="h-6 w-6 animate-spin rounded-full border-4 border-t-transparent" style={{ borderColor: '#01696e', borderTopColor: 'transparent' }} />
        </div>
      ) : accounts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 py-8 text-center text-sm text-gray-400">
          Aucun compte configuré — ajoutez votre clé API Getaround pour synchroniser votre flotte
        </div>
      ) : (
        <div className="space-y-3">
          {accounts.map((acc: GetaroundAccount) => (
            <div key={acc.id} className={`rounded-xl border bg-gray-50 p-4 ${acc.syncError ? 'border-red-200' : 'border-gray-200'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-900">{acc.name}</span>
                    <span className="rounded-full bg-[#01696e]/10 px-2 py-0.5 text-xs text-[#01696e]">
                      {acc._count.vehicles} véhicule{acc._count.vehicles !== 1 ? 's' : ''}
                    </span>
                    {acc.syncStatus === 'ok' && (
                      <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-600">Actif</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-gray-400">Dernière sync : {fmtRelative(acc.lastSyncAt)}</p>
                  {acc.syncError && <p className="mt-0.5 text-xs text-red-500">{acc.syncError}</p>}
                  {syncMsg[`v-${acc.id}`] && <p className="mt-0.5 text-xs text-green-600">{syncMsg[`v-${acc.id}`]}</p>}
                  {syncMsg[`r-${acc.id}`] && <p className="mt-0.5 text-xs text-green-600">{syncMsg[`r-${acc.id}`]}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button type="button"
                    onClick={() => syncVehiclesMutation.mutate(acc.id)}
                    disabled={isSyncing}
                    title="Synchroniser les véhicules"
                    className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                    {syncVehiclesMutation.isPending && syncVehiclesMutation.variables === acc.id ? '...' : 'Véhicules'}
                  </button>
                  <button type="button"
                    onClick={() => syncRentalsMutation.mutate(acc.id)}
                    disabled={isSyncing}
                    title="Synchroniser les locations"
                    className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                    {syncRentalsMutation.isPending && syncRentalsMutation.variables === acc.id ? '...' : 'Locations'}
                  </button>
                  <button type="button"
                    onClick={() => { setEditKeyId(acc.id); setNewKey(''); }}
                    title="Modifier la clé API"
                    className="rounded-lg border border-gray-200 bg-white p-1.5 text-gray-400 hover:text-[#01696e]">
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                    </svg>
                  </button>
                  <button type="button"
                    onClick={() => { if (confirm(`Supprimer le compte "${acc.name}" ? Cette action déconnectera les véhicules associés.`)) deleteMutation.mutate(acc.id); }}
                    className="rounded-lg border border-gray-200 bg-white p-1.5 text-gray-300 hover:text-red-500">
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {editKeyId === acc.id && (
                <div className="mt-3 flex items-center gap-2 border-t border-gray-200 pt-3">
                  <input type="password" value={newKey} onChange={e => setNewKey(e.target.value)}
                    className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-mono outline-none focus:border-[#01696e]"
                    placeholder="Nouvelle clé API..." />
                  <button type="button"
                    disabled={!newKey || updateKeyMutation.isPending}
                    onClick={() => updateKeyMutation.mutate({ id: acc.id, key: newKey })}
                    className="rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
                    style={{ backgroundColor: '#01696e' }}>
                    {updateKeyMutation.isPending ? '...' : 'Valider'}
                  </button>
                  <button type="button" onClick={() => setEditKeyId(null)}
                    className="rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50">
                    Annuler
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const AI_MODES = [
  { value: 'auto', label: 'Automatique', desc: 'Envoie la réponse IA directement sans validation' },
  { value: 'approval', label: 'Approbation', desc: 'Génère un brouillon à approuver avant envoi' },
  { value: 'manual', label: 'Manuel', desc: 'L\'IA n\'intervient pas sur ce type de message' },
];

function ModeSelector({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }): React.JSX.Element {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold text-gray-700">{label}</p>
      <div className="grid grid-cols-3 gap-2">
        {AI_MODES.map(m => (
          <button key={m.value} type="button" onClick={() => onChange(m.value)}
            className={`rounded-xl border p-3 text-left transition ${value === m.value ? 'border-[#01696e] bg-[#01696e]/5 text-[#01696e]' : 'border-gray-200 hover:border-gray-300 text-gray-700'}`}>
            <p className="text-xs font-semibold">{m.label}</p>
            <p className="mt-0.5 text-[11px] text-gray-400 leading-tight">{m.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function SettingsPage(): React.JSX.Element {
  const qc = useQueryClient();

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<{ settings: CompanySettings }>('/settings').then(r => r.data.settings),
  });

  const [form, setForm] = useState({
    primaryColor: '#01696e',
    secondaryColor: '#f8f9fa',
    accentColor: '#ff6b35',
    logoUrl: '',
    aiModeCarSeat: 'approval',
    aiModeIncident: 'approval',
    aiModeGeneral: 'approval',
    aiTone: 'vouvoiement',
  });

  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings) {
      setForm({
        primaryColor: settings.primaryColor ?? '#01696e',
        secondaryColor: settings.secondaryColor ?? '#f8f9fa',
        accentColor: settings.accentColor ?? '#ff6b35',
        logoUrl: settings.logoUrl ?? '',
        aiModeCarSeat: settings.aiModeCarSeat ?? 'approval',
        aiModeIncident: settings.aiModeIncident ?? 'approval',
        aiModeGeneral: settings.aiModeGeneral ?? 'approval',
        aiTone: settings.aiTone ?? 'vouvoiement',
      });
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: (data: typeof form) => api.put('/settings', {
      primaryColor: data.primaryColor,
      secondaryColor: data.secondaryColor,
      accentColor: data.accentColor,
      logoUrl: data.logoUrl || undefined,
      aiModeCarSeat: data.aiModeCarSeat as 'auto' | 'approval' | 'manual',
      aiModeIncident: data.aiModeIncident as 'auto' | 'approval' | 'manual',
      aiModeGeneral: data.aiModeGeneral as 'auto' | 'approval' | 'manual',
      aiTone: data.aiTone as 'vouvoiement' | 'tutoiement',
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    saveMutation.mutate(form);
  }

  return (
    <div className="p-4 lg:p-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Paramètres</h1>
        <p className="text-sm text-gray-500">Configuration de votre espace de gestion</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* Apparence */}
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
          <h2 className="text-sm font-semibold text-gray-900">Apparence</h2>

          <div className="grid gap-4 sm:grid-cols-3">
            {[
              { key: 'primaryColor', label: 'Couleur principale' },
              { key: 'secondaryColor', label: 'Couleur secondaire' },
              { key: 'accentColor', label: 'Couleur d\'accent' },
            ].map(({ key, label }) => (
              <div key={key}>
                <label className="mb-1.5 block text-xs font-medium text-gray-600">{label}</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={(form as Record<string, string>)[key]}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                    className="h-9 w-12 cursor-pointer rounded border border-gray-200 p-0.5" />
                  <input type="text" value={(form as Record<string, string>)[key]}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                    className="flex-1 rounded-lg border border-gray-200 px-2.5 py-2 font-mono text-xs outline-none focus:border-[#01696e]"
                    pattern="^#[0-9a-fA-F]{6}$" />
                </div>
              </div>
            ))}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">URL du logo</label>
            <input type="url" value={form.logoUrl}
              onChange={e => setForm(f => ({ ...f, logoUrl: e.target.value }))}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]"
              placeholder="https://example.com/logo.png" />
          </div>

          {form.logoUrl && (
            <div className="flex items-center gap-3">
              <img src={form.logoUrl} alt="Logo" className="h-12 w-12 rounded-lg object-contain border border-gray-200" />
              <p className="text-xs text-gray-400">Aperçu du logo</p>
            </div>
          )}
        </section>

        {/* IA — Modes */}
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-5">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Intelligence artificielle</h2>
            <p className="text-xs text-gray-400 mt-0.5">Définissez comment l'IA gère chaque type de message</p>
          </div>

          <ModeSelector label="Demandes de siège auto"
            value={form.aiModeCarSeat}
            onChange={v => setForm(f => ({ ...f, aiModeCarSeat: v }))} />

          <ModeSelector label="Signalements d'incidents"
            value={form.aiModeIncident}
            onChange={v => setForm(f => ({ ...f, aiModeIncident: v }))} />

          <ModeSelector label="Messages généraux"
            value={form.aiModeGeneral}
            onChange={v => setForm(f => ({ ...f, aiModeGeneral: v }))} />
        </section>

        {/* IA — Ton */}
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-3">
          <h2 className="text-sm font-semibold text-gray-900">Ton des réponses IA</h2>
          <div className="grid grid-cols-2 gap-3">
            {[
              { value: 'vouvoiement', label: 'Vouvoiement', desc: 'Ton formel et professionnel' },
              { value: 'tutoiement', label: 'Tutoiement', desc: 'Ton plus proche et détendu' },
            ].map(t => (
              <button key={t.value} type="button" onClick={() => setForm(f => ({ ...f, aiTone: t.value }))}
                className={`rounded-xl border p-4 text-left transition ${form.aiTone === t.value ? 'border-[#01696e] bg-[#01696e]/5' : 'border-gray-200 hover:border-gray-300'}`}>
                <p className={`text-sm font-semibold ${form.aiTone === t.value ? 'text-[#01696e]' : 'text-gray-800'}`}>{t.label}</p>
                <p className="text-xs text-gray-400 mt-0.5">{t.desc}</p>
              </button>
            ))}
          </div>
        </section>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button type="submit" disabled={saveMutation.isPending}
            className="rounded-xl px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-60 transition"
            style={{ backgroundColor: '#01696e' }}>
            {saveMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
          </button>
          {saved && <p className="text-sm font-medium text-green-600">Paramètres sauvegardés ✓</p>}
          {saveMutation.isError && <p className="text-sm text-red-600">Erreur lors de la sauvegarde</p>}
        </div>
      </form>

      {/* Comptes Getaround */}
      <GetaroundSection />

      {/* Affichage TV */}
      <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Tableau de bord TV</h2>
            <p className="text-xs text-gray-400 mt-0.5">Affichage plein écran pour moniteur ou TV de bureau</p>
          </div>
          <a href="/tv" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
            Ouvrir le TV
          </a>
        </div>
      </section>
    </div>
  );
}
