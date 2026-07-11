import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { api } from '../../utils/api';
import { getaroundSyncApi, type GetaroundAccount } from '../vehicles/vehiclesApi';
import { useAuth } from '../../hooks/useAuth';
import { trackEvent } from '../../utils/tracking';

// ─── Types utilisateurs ───────────────────────────────────────────────────────
interface UserItem {
  id: string; name: string; email: string; role: string; roles: string[];
  isActive: boolean; lastLoginAt: string | null; createdAt: string;
}
const ROLES_CFG = [
  { value: 'admin',        label: 'Administrateur', color: 'text-green-700' },
  { value: 'carkeeper',    label: 'Car Keeper',     color: 'text-blue-700'  },
  { value: 'exploitation', label: 'Exploitation',   color: 'text-orange-700' },
  { value: 'comptable',    label: 'Comptable',      color: 'text-purple-700' },
] as const;
const ROLE_LBL: Record<string, string> = {
  admin: 'Administrateur', carkeeper: 'Car Keeper',
  exploitation: 'Exploitation', comptable: 'Comptable', third_party_owner: 'Propriétaire tiers',
};
function RoleMultiSelectSettings({ userId, currentRoles, onSave, isLastAdmin }: {
  userId: string; currentRoles: string[]; onSave: (id: string, roles: string[]) => void; isLastAdmin: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(currentRoles);
  const ref = React.useRef<HTMLDivElement>(null);
  useEffect(() => { setSelected(currentRoles); }, [currentRoles.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  function toggle(role: string): void {
    if (role === 'admin' && isLastAdmin && selected.includes('admin')) return;
    const next = selected.includes(role) ? selected.filter(r => r !== role) : [...selected, role];
    if (next.length === 0) return;
    setSelected(next);
    onSave(userId, next);
  }
  const label = ROLES_CFG.filter(r => selected.includes(r.value)).map(r => r.label).join(', ') || 'Sélectionner';
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:border-[#01696e] min-w-[180px] justify-between transition-colors">
        <span className="truncate max-w-[150px] text-left">{label}</span>
        <span className="text-gray-400 text-xs shrink-0">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-52 rounded-xl border border-gray-200 bg-white shadow-lg py-1">
          {ROLES_CFG.map(role => (
            <label key={role.value} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-gray-50 select-none">
              <input type="checkbox" checked={selected.includes(role.value)} onChange={() => toggle(role.value)} className="rounded accent-[#01696e]" />
              <span className={`text-sm font-medium ${role.color}`}>{role.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
function CarekeeperVehiclePanel({ userId, allVehicles }: {
  userId: string;
  allVehicles: Array<{ id: string; make: string; model: string; licensePlate: string }>;
}): React.JSX.Element {
  const qc = useQueryClient();
  const { data: assignedIds = [], isLoading } = useQuery({
    queryKey: ['vehicle-assignments', userId],
    queryFn: () => api.get<{ vehicleIds: string[] }>(`/users/${userId}/vehicle-assignments`).then(r => r.data.vehicleIds),
    staleTime: 0,
  });
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => { setSelected(assignedIds); }, [assignedIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const assignMutation = useMutation({
    mutationFn: (vehicleIds: string[]) => api.put(`/users/${userId}/vehicle-assignments`, { vehicleIds }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['vehicle-assignments', userId] }),
  });
  function toggle(vehicleId: string): void {
    const next = selected.includes(vehicleId) ? selected.filter(id => id !== vehicleId) : [...selected, vehicleId];
    setSelected(next);
    assignMutation.mutate(next);
  }
  if (isLoading) return <div className="text-xs text-gray-400 py-2">Chargement...</div>;
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-blue-700">Véhicules assignés à ce Car Keeper</p>
      {allVehicles.length === 0 ? (
        <p className="text-xs text-gray-400">Aucun véhicule actif</p>
      ) : (
        <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {allVehicles.map(v => (
            <label key={v.id} className="flex items-center gap-2 cursor-pointer rounded-lg px-2 py-1.5 hover:bg-white/80 select-none">
              <input type="checkbox" checked={selected.includes(v.id)} onChange={() => toggle(v.id)}
                className="rounded accent-[#01696e]" />
              <span className="text-xs text-gray-700 truncate">{v.make} {v.model}</span>
              <span className="text-[11px] font-mono text-gray-400 shrink-0">{v.licensePlate}</span>
            </label>
          ))}
        </div>
      )}
      {assignMutation.isPending && <p className="text-[11px] text-gray-400">Enregistrement...</p>}
      {assignMutation.isSuccess && <p className="text-[11px] text-green-600">Sauvegardé ✓</p>}
    </div>
  );
}

function MonCompteSection(): React.JSX.Element {
  const { user } = useAuth();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const mutation = useMutation({
    mutationFn: () => api.patch('/auth/change-password', {
      currentPassword: form.currentPassword,
      newPassword: form.newPassword,
    }),
    onSuccess: () => {
      setMsg({ type: 'ok', text: 'Mot de passe mis à jour avec succès.' });
      setForm({ currentPassword: '', newPassword: '', confirm: '' });
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { error?: string } } };
      setMsg({ type: 'err', text: e.response?.data?.error ?? 'Erreur lors du changement de mot de passe.' });
    },
  });

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    setMsg(null);
    if (form.newPassword !== form.confirm) {
      setMsg({ type: 'err', text: 'Les mots de passe ne correspondent pas.' });
      return;
    }
    if (form.newPassword.length < 8) {
      setMsg({ type: 'err', text: 'Le nouveau mot de passe doit contenir au moins 8 caractères.' });
      return;
    }
    mutation.mutate();
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-gray-900 mb-0.5">Mon compte</h2>
      <p className="text-xs text-gray-400 mb-4">{user?.name} — {user?.email}</p>
      <form onSubmit={handleSubmit} className="space-y-3 max-w-sm">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Mot de passe actuel</label>
          <input type="password" required value={form.currentPassword}
            onChange={e => setForm(f => ({ ...f, currentPassword: e.target.value }))}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e] focus:ring-2 focus:ring-[#01696e]/20" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Nouveau mot de passe</label>
          <input type="password" required minLength={8} value={form.newPassword}
            onChange={e => setForm(f => ({ ...f, newPassword: e.target.value }))}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e] focus:ring-2 focus:ring-[#01696e]/20" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Confirmer le nouveau mot de passe</label>
          <input type="password" required minLength={8} value={form.confirm}
            onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e] focus:ring-2 focus:ring-[#01696e]/20" />
        </div>
        {msg && (
          <p className={`text-xs ${msg.type === 'ok' ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</p>
        )}
        <button type="submit" disabled={mutation.isPending}
          className="rounded-xl bg-[#01696e] px-4 py-2 text-sm font-medium text-white hover:bg-[#015a5f] disabled:opacity-50 transition-colors">
          {mutation.isPending ? 'Mise à jour...' : 'Changer le mot de passe'}
        </button>
      </form>
    </section>
  );
}

function UsersSection(): React.JSX.Element {
  const qc = useQueryClient();
  const [showInvite, setShowInvite] = useState(false);
  const [form, setForm] = useState({ email: '', name: '', roles: ['exploitation'] as string[] });
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [vehiclePanel, setVehiclePanel] = useState<string | null>(null);
  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<{ users: UserItem[] }>('/users').then(r => r.data.users),
    staleTime: 5 * 60_000,
  });
  const { data: allVehicles = [] } = useQuery<Array<{ id: string; make: string; model: string; licensePlate: string }>>({
    queryKey: ['vehicles-active'],
    queryFn: () => api.get<{ vehicles: Array<{ id: string; make: string; model: string; licensePlate: string; isActive: boolean }> }>('/vehicles').then(r => r.data.vehicles.filter(v => v.isActive)),
    staleTime: 5 * 60_000,
  });
  const inviteMutation = useMutation({
    mutationFn: (body: typeof form) => api.post<{ user: UserItem; inviteUrl: string }>('/users/invite', {
      email: body.email, name: body.name, role: body.roles[0] ?? 'exploitation', roles: body.roles,
    }),
    onSuccess: (res) => { void qc.invalidateQueries({ queryKey: ['users'] }); setInviteLink(res.data.inviteUrl); setForm({ email: '', name: '', roles: ['exploitation'] }); },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: string; isActive?: boolean }) => api.put(`/users/${id}`, data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['users'] }),
  });
  const rolesMutation = useMutation({
    mutationFn: ({ id, roles }: { id: string; roles: string[] }) => api.put(`/users/${id}/roles`, { roles }),
    onSuccess: () => { setRoleError(null); void qc.invalidateQueries({ queryKey: ['users'] }); },
    onError: (err: unknown) => { setRoleError((err as { response?: { data?: { error?: string } } }).response?.data?.error ?? 'Erreur rôles'); },
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/users/${id}`),
    onSuccess: (_, deletedId) => {
      setDeleteError(null);
      qc.setQueryData<UserItem[]>(['users'], old => (old ?? []).filter(u => u.id !== deletedId));
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err: unknown) => { setDeleteError((err as { response?: { data?: { error?: string } } }).response?.data?.error ?? 'Erreur suppression'); },
  });
  function handleSaveRoles(userId: string, roles: string[]): void {
    const others = users.filter(u => u.id !== userId && (u.roles?.includes('admin') || u.role === 'admin'));
    if (!roles.includes('admin') && others.length === 0) { setRoleError('Impossible de retirer Admin — dernier administrateur'); return; }
    rolesMutation.mutate({ id: userId, roles });
  }
  const isLastAdminFn = (userId: string) => {
    const admins = users.filter(u => u.roles?.includes('admin') || u.role === 'admin');
    return admins.length <= 1 && admins[0]?.id === userId;
  };
  return (
    <section id="users" className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Utilisateurs &amp; rôles</h2>
          <p className="mt-0.5 text-xs text-gray-400">{users.length} membre{users.length !== 1 ? 's' : ''}</p>
        </div>
        <button type="button" data-testid="btn-inviter" onClick={() => { setShowInvite(true); setInviteLink(null); }}
          className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-white" style={{ backgroundColor: '#01696e' }}>
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Inviter
        </button>
      </div>
      {showInvite && (
        <div data-testid="modal-inviter" className="mb-4 rounded-xl border border-[#01696e]/20 bg-[#01696e]/5 p-4 space-y-3">
          <h3 className="text-xs font-semibold text-gray-900">Inviter un membre</h3>
          {inviteLink ? (
            <div className="space-y-2">
              <p className="text-xs text-gray-700">Lien d'invitation créé :</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-lg bg-white border border-gray-200 px-3 py-2 text-xs text-gray-700 break-all">{inviteLink}</code>
                <button type="button" onClick={() => void navigator.clipboard.writeText(inviteLink)}
                  className="shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">Copier</button>
              </div>
              <button type="button" onClick={() => { setShowInvite(false); setInviteLink(null); }} className="text-xs text-[#01696e] hover:underline">Fermer</button>
            </div>
          ) : (
            <form onSubmit={e => { e.preventDefault(); inviteMutation.mutate(form); }} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Nom *</label>
                  <input required type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#01696e]" placeholder="Marie Dupont" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Email *</label>
                  <input required type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#01696e]" placeholder="marie@example.com" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Rôles *</label>
                  <RoleMultiSelectSettings userId="" currentRoles={form.roles}
                    onSave={(_, roles) => setForm(f => ({ ...f, roles }))} isLastAdmin={false} />
                </div>
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={inviteMutation.isPending}
                  className="rounded-xl px-4 py-2 text-xs font-semibold text-white disabled:opacity-60" style={{ backgroundColor: '#01696e' }}>
                  {inviteMutation.isPending ? 'Envoi...' : "Envoyer l'invitation"}
                </button>
                <button type="button" onClick={() => setShowInvite(false)}
                  className="rounded-xl border border-gray-200 px-4 py-2 text-xs text-gray-700 hover:bg-gray-50">Annuler</button>
              </div>
              {inviteMutation.isError && <p className="text-xs text-red-600">Erreur lors de l'invitation</p>}
            </form>
          )}
        </div>
      )}
      {roleError && <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">{roleError}<button type="button" onClick={() => setRoleError(null)} className="ml-2 text-red-400">✕</button></div>}
      {deleteError && <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">{deleteError}<button type="button" onClick={() => setDeleteError(null)} className="ml-2 text-red-400">✕</button></div>}
      {isLoading ? (
        <div className="flex justify-center py-8"><div className="h-6 w-6 animate-spin rounded-full border-4 border-t-transparent" style={{ borderColor: '#01696e', borderTopColor: 'transparent' }} /></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500">Membre</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500">Rôles</th>
                <th className="hidden px-3 py-2.5 text-left text-xs font-semibold text-gray-500 sm:table-cell">Dernière connexion</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500">Statut</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {users.map(u => {
                const uRoles = u.roles?.length ? u.roles : [u.role];
                const isCarkeeper = uRoles.includes('carkeeper');
                return (
                  <React.Fragment key={u.id}>
                    <tr className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2.5"><p className="font-medium text-gray-900 text-xs">{u.name}</p><p className="text-[11px] text-gray-400">{u.email}</p></td>
                      <td className="px-3 py-2.5">
                        <RoleMultiSelectSettings userId={u.id} currentRoles={uRoles}
                          onSave={handleSaveRoles} isLastAdmin={isLastAdminFn(u.id)} />
                        <div className="mt-1 flex flex-wrap gap-1">
                          {uRoles.map(r => (
                            <span key={r} className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">{ROLE_LBL[r] ?? r}</span>
                          ))}
                        </div>
                      </td>
                      <td className="hidden px-3 py-2.5 text-[11px] text-gray-400 sm:table-cell">
                        {u.lastLoginAt ? format(new Date(u.lastLoginAt), 'dd/MM/yyyy HH:mm', { locale: fr }) : 'Jamais'}
                      </td>
                      <td className="px-3 py-2.5">
                        <button type="button" onClick={() => updateMutation.mutate({ id: u.id, isActive: !u.isActive })}
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition ${u.isActive ? 'bg-green-50 text-green-700 hover:bg-green-100' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${u.isActive ? 'bg-green-500' : 'bg-gray-400'}`} />
                          {u.isActive ? 'Actif' : 'Inactif'}
                        </button>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {isCarkeeper && (
                          <button type="button" data-testid="btn-assign-vehicles" onClick={() => setVehiclePanel(p => p === u.id ? null : u.id)}
                            className={`mr-1 rounded p-1 transition ${vehiclePanel === u.id ? 'text-blue-600' : 'text-blue-300 hover:text-blue-500'}`}
                            title="Véhicules assignés">
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10l2 2h8l2-2z" /></svg>
                          </button>
                        )}
                        <button type="button" onClick={() => { if (confirm(`Supprimer ${u.name} ?`)) deleteMutation.mutate(u.id); }}
                          className="rounded p-1 text-gray-300 hover:text-red-500 transition" title="Supprimer">
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </td>
                    </tr>
                    {vehiclePanel === u.id && (
                      <tr className="border-b border-gray-100 bg-blue-50/40">
                        <td colSpan={5} className="px-4 py-3">
                          <CarekeeperVehiclePanel userId={u.id} allVehicles={allVehicles} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function defaultStartDate(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().split('T')[0] ?? '';
}

// ─── Section Feedback ─────────────────────────────────────────────────────────

interface TenantFeedback {
  id: string;
  type: string;
  title: string;
  status: string;
  submittedAt: string;
}

const FEEDBACK_TYPE_LABELS: Record<string, string> = {
  bug: '🐛 Bug',
  feature: '💡 Fonctionnalité',
  feedback: '💬 Retour',
};

function FeedbackSection(): React.JSX.Element {
  const [form, setForm] = useState({ type: 'feedback', title: '', description: '' });
  const [sent, setSent] = useState(false);

  const { data: feedbacks = [], refetch } = useQuery<TenantFeedback[]>({
    queryKey: ['my-feedbacks'],
    queryFn: () => api.get<{ feedbacks: TenantFeedback[] }>('/feedback/mine').then(r => r.data.feedbacks),
    staleTime: 5 * 60_000,
  });

  const submitMutation = useMutation({
    mutationFn: () => api.post('/feedback', form),
    onSuccess: () => {
      setSent(true);
      setForm({ type: 'feedback', title: '', description: '' });
      void refetch();
      setTimeout(() => setSent(false), 3000);
    },
  });

  const STATUS_COLORS: Record<string, string> = {
    new: 'bg-blue-100 text-blue-700',
    in_progress: 'bg-yellow-100 text-yellow-700',
    done: 'bg-green-100 text-green-700',
    rejected: 'bg-gray-100 text-gray-500',
  };
  const STATUS_LABELS: Record<string, string> = {
    new: 'Nouveau', in_progress: 'En cours', done: 'Traité', rejected: 'Refusé',
  };

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">Demandes & remontées</h2>
        <p className="mt-0.5 text-xs text-gray-400">Signalez un bug, suggérez une fonctionnalité ou partagez un retour</p>
      </div>

      <form onSubmit={e => { e.preventDefault(); submitMutation.mutate(); }} className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Type</label>
          <div className="flex gap-2">
            {([
              { value: 'bug', label: '🐛 Bug' },
              { value: 'feature', label: '✨ Fonctionnalité' },
              { value: 'feedback', label: '💬 Retour' },
            ] as const).map(({ value, label }) => (
              <button key={value} type="button"
                onClick={() => setForm(f => ({ ...f, type: value }))}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  form.type === value
                    ? 'border-[#01696e] bg-[#01696e]/10 text-[#01696e]'
                    : 'border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700'
                }`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Titre</label>
          <input required value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            placeholder="Résumé en quelques mots..."
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#01696e]/30" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Description</label>
          <textarea required rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            placeholder="Décrivez le problème ou la fonctionnalité souhaitée..."
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#01696e]/30 resize-none" />
        </div>
        <div className="flex items-center gap-3">
          <button type="submit" disabled={submitMutation.isPending}
            className="rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            style={{ backgroundColor: '#01696e' }}>
            {submitMutation.isPending ? 'Envoi...' : 'Envoyer'}
          </button>
          {sent && <p className="text-sm text-green-600">Demande envoyée ✓</p>}
          {submitMutation.isError && <p className="text-sm text-red-600">Erreur lors de l'envoi</p>}
        </div>
      </form>

      {feedbacks.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-gray-100">
          <p className="text-xs font-medium text-gray-400">Mes demandes</p>
          {feedbacks.map(fb => (
            <div key={fb.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-sm">
              <div className="min-w-0">
                <span className="text-xs text-gray-400 mr-2">{FEEDBACK_TYPE_LABELS[fb.type] ?? fb.type}</span>
                <span className="text-gray-700 truncate">{fb.title}</span>
              </div>
              <span className={`ml-2 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[fb.status] ?? 'bg-gray-100 text-gray-500'}`}>
                {STATUS_LABELS[fb.status] ?? fb.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const GOOGLE_FONTS = [
  'Montserrat', 'Inter', 'Roboto', 'Poppins', 'Lato',
  'Open Sans', 'Nunito', 'Raleway', 'Source Sans 3', 'DM Sans',
] as const;

interface CompanySettings {
  id: string;
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
  logoUrl: string | null;
  fontFamily: string;
  aiModeCarSeat: string;
  aiModeIncident: string;
  aiModeGeneral: string;
  aiTone: string;
  aiName: string;
  alertEmails: string[];
  replyToEmail: string | null;
  senderName: string | null;
  invoiceSyncWindowDays: number;
  invoiceActiveTypes: string[];
  invoiceMalusConfig: Record<string, number>;
  journalCode: string;
  compteLocationsProduit: string;
  compteCompensationsProduit: string;
  compteEntretienCharge: string;
  compteAssuranceCharge: string;
  compteParkingCharge: string;
  formatExportPreference: string;
  objectifSeuilAlerte: number;
  autobizApiKey: string | null;
  depreciationThreshold: number;
  warrantyAlertDays: number;
  boitierConnectAmount: number | null;
  co2FactorEssence: number;
  co2FactorHybride: number;
  co2FactorElectrique: number;
  co2EquivalentArbre: number;
  // Intelligence
  ratingDropThreshold: number;
  underutilizationThreshold: number;
  underutilizationWeeks: number;
  riskScoreAlertThreshold: number;
  riskWeightScore: number;
  riskWeightFlags: number;
  riskWeightCancelled: number;
  riskWeightDelay: number;
  slackWebhookUrl: string | null;
  // Revente & Décote
  depreciationRateYear1: number;
  depreciationRateYear2: number;
  depreciationRateYear3: number;
  depreciationRateYears4to6: number;
  depreciationRateAfter6: number;
  majorMaintenanceCost: number;
  majorMaintenanceKm: number;
  roiAlertMonthsBefore: number;
  roiCaMoyenMois: number;
  roiHorizonMonths: number;
  roiCoeffSaison: number[] | null;
  platformName: string | null;
  platformCommissionRate: number | null;
  kmDeclinCA: number;
  kmStopGA: number;
  defaultDepreciationRate: number;
  messageUnansweredMinutes: number | null;
  threadAutoCloseDays: number | null;
}

interface SyncStateData { isRunning: boolean; currentStep: string; progress: number; error: string | null; }

const EMPTY_ACCOUNT = { name: '', apiKey: '' };

function getSyncErrorMessage(error: string | null | undefined): string | null {
  if (!error) return null;
  if (/rate.?limit|429|too many/i.test(error)) return 'Limite d\'appels API atteinte — réessayez dans quelques minutes.';
  if (/401|unauthorized|api.?key|invalid.*key|key.*invalid/i.test(error)) return 'Clé API invalide ou expirée — vérifiez votre clé Getaround.';
  if (/network|ECONNREFUSED|fetch|timeout/i.test(error)) return 'Connexion impossible à Getaround — vérifiez votre connexion réseau.';
  if (/403|forbidden/i.test(error)) return 'Accès refusé — votre compte Getaround n\'a pas les permissions nécessaires.';
  return error;
}

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

// ─── 2.9 — Champ mot de passe avec bouton œil ────────────────────────────────

function ApiKeyInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }): React.JSX.Element {
  const [show, setShow] = useState(false);
  return (
    <div className="relative flex items-center">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 pr-9 text-sm font-mono outline-none focus:border-[#01696e]"
        placeholder={placeholder ?? '••••••••••••••••'}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow(s => !s)}
        className="absolute right-2 text-gray-400 hover:text-gray-700"
        title={show ? 'Masquer' : 'Afficher'}
      >
        {show ? (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
          </svg>
        ) : (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        )}
      </button>
    </div>
  );
}

// ─── 1. Comptes Getaround ─────────────────────────────────────────────────────

function GetaroundSection(): React.JSX.Element {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_ACCOUNT);
  const [editKeyId, setEditKeyId] = useState<string | null>(null);
  const [newKey, setNewKey] = useState('');
  const [syncMsg, setSyncMsg] = useState<Record<string, string>>({});
  const [deleteGaError, setDeleteGaError] = useState<string | null>(null);
  const [pendingStartDateAccountId, setPendingStartDateAccountId] = useState<string | null>(null);
  const [pendingStartDate, setPendingStartDate] = useState(defaultStartDate());

  const { data: syncStatus } = useQuery<SyncStateData>({
    queryKey: ['sync-status'],
    queryFn: () => api.get<{ state: SyncStateData }>('/sync/status').then(r => r.data.state),
    refetchInterval: (query) => ((query.state.data as SyncStateData | undefined)?.isRunning ? 2_000 : 15_000),
    staleTime: 1_000,
  });

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['getaround-accounts'],
    queryFn: getaroundSyncApi.listAccounts,
  });

  const saveStartDateMutation = useMutation({
    mutationFn: ({ id, date }: { id: string; date: string }) =>
      getaroundSyncApi.updateAccountStartDate(id, date ? new Date(date).toISOString() : null),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['getaround-accounts'] });
      void qc.invalidateQueries({ queryKey: ['onboarding-progress'] });
    },
  });

  const createMutation = useMutation({
    mutationFn: () => getaroundSyncApi.createAccount(form.name, form.apiKey),
    onSuccess: (newAccount) => {
      void qc.invalidateQueries({ queryKey: ['getaround-accounts'] });
      void qc.invalidateQueries({ queryKey: ['onboarding-progress'] });
      setShowForm(false);
      setForm(EMPTY_ACCOUNT);
      // Demander la date de début après la création du compte
      setPendingStartDateAccountId(newAccount.id);
      setPendingStartDate(defaultStartDate());
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => getaroundSyncApi.deleteAccount(id),
    onSuccess: () => {
      setDeleteGaError(null);
      void qc.invalidateQueries({ queryKey: ['getaround-accounts'] });
      void qc.invalidateQueries({ queryKey: ['onboarding-progress'] });
    },
    onError: (err: unknown) => {
      setDeleteGaError((err as { response?: { data?: { error?: string } } }).response?.data?.error ?? 'Erreur lors de la suppression du compte');
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
      void qc.invalidateQueries({ queryKey: ['rentals'] });
      void qc.invalidateQueries({ queryKey: ['messages'] });
      void qc.invalidateQueries({ queryKey: ['onboarding-progress'] });
      setSyncMsg(prev => ({ ...prev, [`r-${id}`]: `Locations : +${result?.created ?? 0}, ${result?.updated ?? 0} mises à jour` }));
      setTimeout(() => setSyncMsg(prev => { const n = { ...prev }; delete n[`r-${id}`]; return n; }), 4000);
    },
  });

  const syncAllMutation = useMutation({
    mutationFn: getaroundSyncApi.syncAll,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['vehicles'] });
      void qc.invalidateQueries({ queryKey: ['rentals'] });
      void qc.invalidateQueries({ queryKey: ['messages'] });
      void qc.invalidateQueries({ queryKey: ['getaround-accounts'] });
      void qc.invalidateQueries({ queryKey: ['onboarding-progress'] });
    },
  });

  const [forceFullMsg, setForceFullMsg] = useState<string | null>(null);
  const forceFullMutation = useMutation({
    mutationFn: () => api.post<{ message: string }>('/sync/force-full').then(r => r.data.message),
    onSuccess: (msg) => {
      setForceFullMsg(msg);
      void qc.invalidateQueries({ queryKey: ['sync-status'] });
      setTimeout(() => setForceFullMsg(null), 8000);
    },
  });

  const [recalcMsg, setRecalcMsg] = useState<string | null>(null);
  const recalcPayoutsMutation = useMutation({
    mutationFn: () => api.get<{ message: string }>('/sync/recalculate-payouts').then(r => r.data.message),
    onSuccess: () => {
      setRecalcMsg('Recalcul lancé — données disponibles dans 20-30 minutes');
      setTimeout(() => setRecalcMsg(null), 10_000);
    },
  });

  const isSyncing = syncVehiclesMutation.isPending || syncRentalsMutation.isPending || syncAllMutation.isPending || (syncStatus?.isRunning ?? false);

  return (
    <section id="getaround" className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Comptes Getaround</h2>
          <p className="text-xs text-gray-400 mt-0.5">Clés API pour la synchronisation de votre flotte</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => forceFullMutation.mutate()} disabled={isSyncing || forceFullMutation.isPending}
            title="Remet lastSyncAt à zéro et resynchronise tout l'historique"
            className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-40">
            {forceFullMutation.isPending ? 'Lancement...' : 'Resync complète'}
          </button>
          <button type="button" onClick={() => recalcPayoutsMutation.mutate()} disabled={recalcPayoutsMutation.isPending}
            title="Recalcule la décomposition CA depuis les virements Getaround sur 24 mois"
            className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-40">
            {recalcPayoutsMutation.isPending ? 'Lancement...' : 'Recalculer les virements'}
          </button>
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

      {/* Message resync complète */}
      {forceFullMsg && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          {forceFullMsg} — cela peut prendre 20-30 minutes
        </div>
      )}

      {/* Toast recalcul virements */}
      {recalcMsg && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800">
          {recalcMsg}
        </div>
      )}

      {/* Sync progress */}
      {syncStatus?.isRunning && (
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-[#01696e] border-t-transparent" />
              {syncStatus.currentStep}
            </span>
            <span>{syncStatus.progress}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div className="h-full rounded-full bg-[#01696e] transition-all duration-500" style={{ width: `${syncStatus.progress}%` }} />
          </div>
        </div>
      )}

      {/* Erreur sync */}
      {syncStatus?.error && !syncStatus.isRunning && (
        <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <div>
            <p className="text-xs font-semibold text-red-800">
              {syncStatus.error.toLowerCase().includes('rate') || syncStatus.error.toLowerCase().includes('429') || syncStatus.error.toLowerCase().includes('trop')
                ? 'Limite Getaround atteinte — réessayez dans quelques minutes'
                : `Erreur de synchronisation : ${syncStatus.error}`}
            </p>
          </div>
          <button type="button" onClick={() => syncAllMutation.mutate()}
            disabled={isSyncing}
            className="ml-4 shrink-0 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-40">
            Réessayer
          </button>
        </div>
      )}

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
              <ApiKeyInput value={form.apiKey} onChange={v => setForm(f => ({ ...f, apiKey: v }))} />
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

      {/* Modal date de début — affiché après création d'un nouveau compte */}
      {pendingStartDateAccountId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-xl space-y-4">
            <h3 className="text-sm font-semibold text-gray-900">Date de début de votre compte Getaround</h3>
            <p className="text-xs text-gray-500 leading-relaxed">
              Indiquez à partir de quelle date ce compte est actif sur Getaround.
              Cela évite de chercher un historique inexistant et accélère la première synchronisation.
            </p>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Date de début *</label>
              <input
                type="date"
                value={pendingStartDate}
                max={new Date().toISOString().split('T')[0]}
                onChange={e => setPendingStartDate(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#01696e]"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!pendingStartDate || saveStartDateMutation.isPending}
                onClick={() => {
                  saveStartDateMutation.mutate(
                    { id: pendingStartDateAccountId, date: pendingStartDate },
                    { onSettled: () => setPendingStartDateAccountId(null) },
                  );
                }}
                className="flex-1 rounded-xl px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
                style={{ backgroundColor: '#01696e' }}>
                {saveStartDateMutation.isPending ? 'Enregistrement...' : 'Confirmer'}
              </button>
              <button
                type="button"
                onClick={() => setPendingStartDateAccountId(null)}
                className="rounded-xl border border-gray-200 px-4 py-2 text-xs text-gray-600 hover:bg-gray-50">
                Ignorer
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteGaError && (
        <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
          {deleteGaError}
          <button type="button" onClick={() => setDeleteGaError(null)} className="ml-2 text-red-400">✕</button>
        </div>
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
                  <p className="mt-0.5 text-xs text-gray-400">
                    Début compte :{' '}
                    {acc.accountStartDate
                      ? new Date(acc.accountStartDate).toLocaleDateString('fr-FR')
                      : <span className="text-amber-500">non défini</span>}
                    <button
                      type="button"
                      title="Modifier la date de début"
                      onClick={() => {
                        setPendingStartDateAccountId(acc.id);
                        setPendingStartDate(
                          acc.accountStartDate
                            ? (acc.accountStartDate.split('T')[0] ?? defaultStartDate())
                            : defaultStartDate()
                        );
                      }}
                      className="ml-1.5 text-gray-400 hover:text-[#01696e]">
                      ✎
                    </button>
                  </p>
                  {acc.syncError && <p className="mt-0.5 text-xs text-red-500">{getSyncErrorMessage(acc.syncError)}</p>}
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
                    onClick={() => { if (confirm(`Supprimer le compte "${acc.name}" ?`)) deleteMutation.mutate(acc.id); }}
                    className="rounded-lg border border-gray-200 bg-white p-1.5 text-gray-300 hover:text-red-500">
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {editKeyId === acc.id && (
                <div className="mt-3 flex items-center gap-2 border-t border-gray-200 pt-3">
                  <div className="flex-1">
                    <ApiKeyInput value={newKey} onChange={setNewKey} placeholder="Nouvelle clé API..." />
                  </div>
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

      {/* URL Webhook Getaround — non utilisé, désactivé le 11/07/2026 */}
      <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4 opacity-60">
        <p className="text-xs font-semibold text-gray-700 mb-1">Webhook Getaround — non utilisé</p>
        <p className="text-xs text-gray-400">
          Le webhook est désactivé. Toutes les données (locations, messages) proviennent
          exclusivement de la synchronisation automatique (cron toutes les 15 min).
        </p>
      </div>
    </section>
  );
}

// ─── Telegram ─────────────────────────────────────────────────────────────────

function TelegramSection(): React.JSX.Element {
  const qc = useQueryClient();
  const [chatId, setChatId] = useState('');
  const [saved, setSaved] = useState(false);

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<{ settings: CompanySettings & { notificationSettings?: Record<string, unknown> } }>('/settings').then(r => r.data.settings),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    const ns = settings?.notificationSettings as Record<string, unknown> | undefined;
    if (typeof ns?.telegram_chat_id === 'string') setChatId(ns.telegram_chat_id);
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: (id: string) => api.put('/settings', { notificationSettings: { telegram_chat_id: id } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  return (
    <div className="border-t border-gray-100 pt-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gray-900">Telegram</p>
          <p className="text-xs text-gray-400 mt-0.5">Alertes temps réel : nouvelles réservations, carburant, sièges auto, locataires non répondants, CT</p>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <input value={chatId} onChange={e => setChatId(e.target.value)}
          placeholder="Chat ID Telegram (ex: -1001234567890)"
          className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono outline-none focus:border-[#01696e]" />
        <button type="button" disabled={saveMutation.isPending}
          onClick={() => saveMutation.mutate(chatId)}
          className="rounded-xl px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
          style={{ backgroundColor: '#01696e' }}>
          {saveMutation.isPending ? '...' : 'Sauvegarder'}
        </button>
      </div>
      {saved && <p className="mt-1 text-xs text-green-600">Chat ID sauvegardé ✓</p>}
      <p className="mt-1.5 text-[11px] text-gray-400">
        Pour obtenir votre Chat ID : créez un bot avec @BotFather, ajoutez-le au groupe, puis envoyez un message et vérifiez <code>api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code>
      </p>
    </div>
  );
}

// ─── Slack ────────────────────────────────────────────────────────────────────

function SlackSection(): React.JSX.Element {
  const { user } = useAuth();
  const qc = useQueryClient();
  const plan = user?.plan ?? 'starter';
  const isEnterprise = plan === 'enterprise';

  const [webhookUrl, setWebhookUrl] = useState('');
  const [testResult, setTestResult] = useState<{ sent: boolean; reason?: string } | null>(null);
  const [saved, setSaved] = useState(false);

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<{ settings: CompanySettings }>('/settings').then(r => r.data.settings),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (settings?.slackWebhookUrl) setWebhookUrl(settings.slackWebhookUrl);
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: (url: string) => api.put('/settings', { slackWebhookUrl: url || null }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  const testMutation = useMutation({
    mutationFn: () => api.post<{ sent: boolean; reason?: string }>('/notifications/slack/test', {}).then(r => r.data),
    onSuccess: (data) => { setTestResult(data); setTimeout(() => setTestResult(null), 4000); },
  });

  if (!isEnterprise) return (
    <div className="border-t border-gray-100 pt-4" data-testid="slack-section">
      <div className="flex items-start gap-3">
        <div>
          <p className="text-sm font-medium text-gray-900">Slack</p>
          <p className="text-xs text-gray-400 mt-0.5">Notifications dans votre espace Slack — disponible avec le plan Enterprise</p>
        </div>
        <span className="ml-auto rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">Enterprise</span>
      </div>
    </div>
  );

  return (
    <div className="border-t border-gray-100 pt-4" data-testid="slack-section">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gray-900">Slack</p>
          <p className="text-xs text-gray-400 mt-0.5">
            Recevez les alertes critiques dans votre workspace Slack via un Incoming Webhook
          </p>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <input value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)}
          placeholder="https://hooks.slack.com/services/T.../B.../..."
          data-testid="input-slack-webhook"
          className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono outline-none focus:border-[#01696e]" />
        <button type="button" disabled={saveMutation.isPending}
          onClick={() => saveMutation.mutate(webhookUrl)}
          className="rounded-xl px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
          style={{ backgroundColor: '#01696e' }}>
          {saveMutation.isPending ? '...' : 'Sauvegarder'}
        </button>
        <button type="button" disabled={testMutation.isPending || !webhookUrl}
          onClick={() => testMutation.mutate()}
          className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40">
          {testMutation.isPending ? 'Envoi...' : 'Tester'}
        </button>
      </div>
      {saved && <p className="mt-1 text-xs text-green-600">Webhook Slack sauvegardé ✓</p>}
      {testResult && (
        <p className={`mt-1 text-xs ${testResult.sent ? 'text-green-600' : 'text-red-600'}`}>
          {testResult.sent ? 'Message Slack envoyé ✓' : `Erreur : ${testResult.reason ?? 'webhook non configuré'}`}
        </p>
      )}
      <p className="mt-1.5 text-[11px] text-gray-400">
        Créez un Incoming Webhook dans votre espace Slack : <em>Mon espace → Apps → Incoming Webhooks</em>
      </p>
    </div>
  );
}

// ─── AI Modes + Ton ──────────────────────────────────────────────────────────

const AI_MODES = [
  { value: 'auto', label: 'Automatique', desc: 'Envoie la réponse IA directement sans validation' },
  { value: 'approval', label: 'Approbation', desc: 'Génère un brouillon à approuver avant envoi' },
  { value: 'manual', label: 'Manuel', desc: "L'IA n'intervient pas sur ce type de message" },
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

// ─── Page principale ──────────────────────────────────────────────────────────

// ─── Destinataires alertes email ─────────────────────────────────────────────

function AlertEmailsSection(): React.JSX.Element {
  const qc = useQueryClient();
  const [emailInput, setEmailInput] = useState('');
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<{ settings: CompanySettings }>('/settings').then(r => r.data.settings),
    staleTime: 5 * 60_000,
  });

  const [senderName, setSenderName] = useState('');
  const [replyToEmail, setReplyToEmail] = useState('');

  useEffect(() => {
    if (settings) {
      setSenderName(settings.senderName ?? '');
      setReplyToEmail(settings.replyToEmail ?? '');
    }
  }, [settings]);

  const alertEmails = settings?.alertEmails ?? [];

  const saveMutation = useMutation({
    mutationFn: (data: { alertEmails?: string[]; senderName?: string | null; replyToEmail?: string | null }) =>
      api.put('/settings', data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['settings'] }),
  });

  const testMutation = useMutation({
    mutationFn: () => api.post<{ success: boolean; sentTo: string[] }>('/settings/test-email'),
    onSuccess: (res) => {
      setTestResult({ ok: true, msg: `Email envoyé à ${res.data.sentTo.join(', ')}` });
      setTimeout(() => setTestResult(null), 5000);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } }).response?.data?.error ?? 'Erreur';
      setTestResult({ ok: false, msg });
      setTimeout(() => setTestResult(null), 5000);
    },
  });

  function addEmail(): void {
    const e = emailInput.trim().toLowerCase();
    if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return;
    if (alertEmails.includes(e) || alertEmails.length >= 10) return;
    saveMutation.mutate({ alertEmails: [...alertEmails, e] });
    setEmailInput('');
  }

  function removeEmail(email: string): void {
    saveMutation.mutate({ alertEmails: alertEmails.filter(a => a !== email) });
  }

  function saveEmailSettings(): void {
    saveMutation.mutate({
      senderName: senderName || null,
      replyToEmail: replyToEmail || null,
    });
  }

  return (
    <div className="space-y-4 border-t border-gray-100 pt-4">
      <div>
        <p className="text-xs font-semibold text-gray-700">Emails sortants</p>
      </div>

      {/* Nom expéditeur */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Nom de l'expéditeur</label>
          <input type="text" value={senderName} onChange={e => setSenderName(e.target.value)}
            onBlur={saveEmailSettings}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]"
            placeholder="Sun and Drive Paris" />
          <p className="mt-0.5 text-[11px] text-gray-400">Affiché dans le champ "De" des emails</p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Email de réponse</label>
          <input type="email" value={replyToEmail} onChange={e => setReplyToEmail(e.target.value)}
            onBlur={saveEmailSettings}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]"
            placeholder="contact@monentreprise.fr" />
          <p className="mt-0.5 text-[11px] text-gray-400">Les réponses à vos emails arriveront ici</p>
        </div>
      </div>

      {/* Destinataires alertes */}
      <div>
        <p className="mb-1 text-xs font-semibold text-gray-700">Destinataires des alertes</p>
        <p className="mb-2 text-[11px] text-gray-400">
          Reçoivent toutes les alertes : CT, révisions, carburant, résumé matinal… ({alertEmails.length}/10)
        </p>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {alertEmails.map(email => (
            <span key={email} className="flex items-center gap-1 rounded-full bg-[#01696e]/10 px-2.5 py-0.5 text-xs text-[#01696e]">
              {email}
              <button type="button" onClick={() => removeEmail(email)}
                className="ml-0.5 text-[#01696e]/60 hover:text-red-500 leading-none">×</button>
            </span>
          ))}
        </div>
        {alertEmails.length < 10 && (
          <div className="flex gap-2">
            <input type="email" value={emailInput} onChange={e => setEmailInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addEmail(); } }}
              className="flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-[#01696e]"
              placeholder="email@exemple.com" />
            <button type="button" onClick={addEmail}
              disabled={saveMutation.isPending}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
              style={{ backgroundColor: '#01696e' }}>
              Ajouter
            </button>
          </div>
        )}
      </div>

      {/* Test email */}
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => testMutation.mutate()}
          disabled={testMutation.isPending || alertEmails.length === 0}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition-colors">
          {testMutation.isPending ? 'Envoi...' : '📧 Envoyer un email de test'}
        </button>
        {testResult && (
          <p className={`text-xs ${testResult.ok ? 'text-green-600' : 'text-red-600'}`}>
            {testResult.ok ? '✓' : '✗'} {testResult.msg}
          </p>
        )}
      </div>
    </div>
  );
}

function ICalSection(): React.JSX.Element {
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);
  const { data } = useQuery({
    queryKey: ['ical-info'],
    queryFn: () => api.get<{ icalToken: string | null; icalUrl: string | null }>('/settings/ical-info').then(r => r.data),
    staleTime: 10 * 60_000,
  });
  const regenerateMutation = useMutation({
    mutationFn: () => api.post<{ icalUrl: string }>('/settings/ical-regenerate'),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ical-info'] });
    },
  });
  const icalUrl = data?.icalUrl;

  function handleCopy(): void {
    if (!icalUrl) return;
    void navigator.clipboard.writeText(icalUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-gray-900">Intégrations</h2>
        <span className="rounded-full bg-[#01696e]/10 px-2 py-0.5 text-[10px] font-semibold text-[#01696e]">Admin uniquement</span>
      </div>
      <div>
        <p className="text-sm font-medium text-gray-900">Lien iCal</p>
        <p className="text-xs text-gray-400 mt-0.5">Synchronisez votre planning avec Google Calendar, Apple Calendar ou tout autre agenda</p>
      </div>
      {icalUrl ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 break-all">{icalUrl}</code>
            <button type="button" onClick={handleCopy}
              className="shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 transition">
              {copied ? '✓ Copié' : 'Copier'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <p className="text-xs text-gray-400">Aucun lien iCal généré</p>
          <button type="button" onClick={() => regenerateMutation.mutate()}
            disabled={regenerateMutation.isPending}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
            style={{ backgroundColor: '#01696e' }}>
            Générer un lien
          </button>
        </div>
      )}
      {icalUrl && (
        <button type="button" onClick={() => regenerateMutation.mutate()}
          disabled={regenerateMutation.isPending}
          className="text-xs text-gray-400 hover:text-gray-600 underline">
          Régénérer le lien (invalide l'ancien)
        </button>
      )}
    </section>
  );
}

// ─── Abonnement ──────────────────────────────────────────────────────────────

const PLAN_LABELS: Record<string, string> = {
  starter: 'Starter', pro: 'Pro', enterprise: 'Enterprise',
};
const PLAN_COLORS: Record<string, string> = {
  starter: 'bg-gray-100 text-gray-600',
  pro: 'bg-blue-100 text-blue-700',
  enterprise: 'bg-purple-100 text-purple-700',
};

function BillingSection(): React.JSX.Element {
  const { user } = useAuth();
  const plan = user?.plan ?? 'starter';
  const hasSubscription = user?.hasActiveSubscription ?? false;

  const portalMutation = useMutation({
    mutationFn: () => api.post<{ url: string }>('/billing/portal').then(r => r.data.url),
    onSuccess: (url) => { window.location.href = url; },
  });

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">Abonnement</h2>
        <p className="mt-0.5 text-xs text-gray-400">Plan actuel et informations de facturation</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${PLAN_COLORS[plan] ?? 'bg-gray-100 text-gray-600'}`}>
            {PLAN_LABELS[plan] ?? plan}
          </span>
          {!hasSubscription && (
            <span className="text-xs text-gray-500">Aucun abonnement actif</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link to="/upgrade"
            className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition">
            Changer de plan
          </Link>
          {hasSubscription && (
            <button type="button"
              onClick={() => portalMutation.mutate()}
              disabled={portalMutation.isPending}
              className="rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 transition"
              style={{ backgroundColor: '#01696e' }}>
              {portalMutation.isPending ? 'Chargement...' : 'Gérer mon abonnement'}
            </button>
          )}
        </div>
      </div>
      {portalMutation.isError && (
        <p className="text-xs text-red-600">Erreur lors de l'accès au portail de facturation</p>
      )}
    </section>
  );
}

function VehicleSettingsSection(): React.JSX.Element {
  const qc = useQueryClient();
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<{ settings: CompanySettings }>('/settings').then(r => r.data.settings),
    staleTime: 5 * 60_000,
  });

  const [form, setForm] = React.useState({
    autobizApiKey: '',
    depreciationThreshold: 0.10,
    warrantyAlertDays: 30,
    co2FactorEssence: 120,
    co2FactorHybride: 60,
    co2FactorElectrique: 10,
    co2EquivalentArbre: 10,
    boitierConnectAmount: 25 as number,
  });
  const [showApiKey, setShowApiKey] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    if (settings) {
      setForm({
        autobizApiKey: settings.autobizApiKey ?? '',
        depreciationThreshold: settings.depreciationThreshold ?? 0.10,
        warrantyAlertDays: settings.warrantyAlertDays ?? 30,
        co2FactorEssence: settings.co2FactorEssence ?? 120,
        co2FactorHybride: settings.co2FactorHybride ?? 60,
        co2FactorElectrique: settings.co2FactorElectrique ?? 10,
        co2EquivalentArbre: settings.co2EquivalentArbre ?? 10,
        boitierConnectAmount: settings.boitierConnectAmount ?? 25,
      });
    }
  }, [settings]);

  const saveMut = useMutation({
    mutationFn: () => api.put('/settings', {
      ...form,
      autobizApiKey: form.autobizApiKey || null,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  function numField(key: keyof typeof form, label: string, unit = '', step = 'any') {
    return (
      <div key={key}>
        <label className="mb-1 block text-xs font-medium text-gray-600">{label}{unit ? ` (${unit})` : ''}</label>
        <input type="number" step={step} value={form[key] as number}
          onChange={e => setForm(f => ({ ...f, [key]: parseFloat(e.target.value) || 0 }))}
          data-testid={`input-vehicle-${key}`}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
      </div>
    );
  }

  return (
    <section data-testid="vehicle-settings-section" className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">Véhicule</h2>
        <p className="mt-0.5 text-xs text-gray-400">Intégrations, dépréciation, garanties et bilan carbone</p>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Clé API Autobiz</label>
        <div className="flex gap-2">
          <input
            type={showApiKey ? 'text' : 'password'}
            value={form.autobizApiKey}
            onChange={e => setForm(f => ({ ...f, autobizApiKey: e.target.value }))}
            placeholder="Clé API Autobiz (optionnel)"
            data-testid="input-vehicle-autobizApiKey"
            className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
          <button type="button" onClick={() => setShowApiKey(v => !v)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50">
            {showApiKey ? 'Masquer' : 'Afficher'}
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {numField('depreciationThreshold', 'Seuil dépréciation revente', '€/km', '0.01')}
        {numField('warrantyAlertDays', 'Alerte garantie avant expiration', 'jours', '1')}
        {numField('boitierConnectAmount', 'Boîtier Connect', '€/mois', '1')}
      </div>

      <div>
        <p className="mb-3 text-xs font-semibold text-gray-700">Facteurs CO₂ (gCO₂/km)</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {numField('co2FactorEssence', 'Essence / Diesel / GPL')}
          {numField('co2FactorHybride', 'Hybride')}
          {numField('co2FactorElectrique', 'Électrique')}
        </div>
      </div>

      {numField('co2EquivalentArbre', 'Équivalent arbre', 'kg CO₂/arbre/an')}

      <div className="flex items-center gap-3 pt-1">
        <button type="button" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}
          className="rounded-xl px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
          style={{ backgroundColor: '#01696e' }}>
          {saveMut.isPending ? 'Enregistrement...' : 'Enregistrer'}
        </button>
        {saved && <p className="text-sm font-medium text-green-600">Sauvegardé ✓</p>}
      </div>
    </section>
  );
}

function ReventeDecoteSection(): React.JSX.Element {
  const qc = useQueryClient();
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<{ settings: CompanySettings }>('/settings').then(r => r.data.settings),
    staleTime: 5 * 60_000,
  });

  const [form, setForm] = React.useState({
    depreciationRateYear1: 0.20,
    depreciationRateYear2: 0.15,
    depreciationRateYear3: 0.12,
    depreciationRateYears4to6: 0.08,
    depreciationRateAfter6: 0.05,
    majorMaintenanceCost: 1500,
    majorMaintenanceKm: 30000,
    roiAlertMonthsBefore: 6,
    roiCaMoyenMois: 5,
    roiHorizonMonths: 48,
    platformCommissionRate: 1.2544,
    kmDeclinCA: 160000,
    kmStopGA: 200000,
    defaultDepreciationRate: 100,
  });
  const [platformName, setPlatformName] = React.useState<string>('');
  const [roiCoeffSaison, setRoiCoeffSaison] = React.useState<number[] | null>(null);
  const [saved, setSaved] = React.useState(false);

  const MONTHS_FR = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

  React.useEffect(() => {
    if (settings) {
      setForm({
        depreciationRateYear1: settings.depreciationRateYear1 ?? 0.20,
        depreciationRateYear2: settings.depreciationRateYear2 ?? 0.15,
        depreciationRateYear3: settings.depreciationRateYear3 ?? 0.12,
        depreciationRateYears4to6: settings.depreciationRateYears4to6 ?? 0.08,
        depreciationRateAfter6: settings.depreciationRateAfter6 ?? 0.05,
        majorMaintenanceCost: settings.majorMaintenanceCost ?? 1500,
        majorMaintenanceKm: settings.majorMaintenanceKm ?? 30000,
        roiAlertMonthsBefore: settings.roiAlertMonthsBefore ?? 6,
        roiCaMoyenMois: settings.roiCaMoyenMois ?? 5,
        roiHorizonMonths: settings.roiHorizonMonths ?? 48,
        platformCommissionRate: settings.platformCommissionRate ?? 1.2544,
        kmDeclinCA: settings.kmDeclinCA ?? 160000,
        kmStopGA: settings.kmStopGA ?? 200000,
        defaultDepreciationRate: settings.defaultDepreciationRate ?? 100,
      });
      setPlatformName(settings.platformName ?? '');
      setRoiCoeffSaison(settings.roiCoeffSaison ?? null);
    }
  }, [settings]);

  const saveMut = useMutation({
    mutationFn: () => api.put('/settings', {
      ...form,
      platformName: platformName.trim() || null,
      roiCoeffSaison,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings'] });
      void qc.invalidateQueries({ queryKey: ['roi-analysis'] });
      void qc.invalidateQueries({ queryKey: ['roi-fleet'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  function pctField(key: keyof typeof form, label: string) {
    const pct = (form[key] as number) * 100;
    return (
      <div key={key}>
        <label className="mb-1 block text-xs font-medium text-gray-600">{label} (%/an)</label>
        <input type="number" min="0" max="100" step="0.1"
          value={parseFloat(pct.toFixed(1))}
          onChange={e => setForm(f => ({ ...f, [key]: parseFloat(e.target.value) / 100 || 0 }))}
          data-testid={`input-roi-${key}`}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
      </div>
    );
  }

  function numField(key: keyof typeof form, label: string, unit = '') {
    return (
      <div key={key}>
        <label className="mb-1 block text-xs font-medium text-gray-600">{label}{unit ? ` (${unit})` : ''}</label>
        <input type="number" min="0" step="1"
          value={form[key] as number}
          onChange={e => setForm(f => ({ ...f, [key]: parseFloat(e.target.value) || 0 }))}
          data-testid={`input-roi-${key}`}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
      </div>
    );
  }

  return (
    <section data-testid="revente-decote-section" className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">Revente & Décote</h2>
        <p className="mt-0.5 text-xs text-gray-400">Paramètres pour le calcul de la fenêtre optimale de revente</p>
      </div>

      <div>
        <p className="mb-3 text-xs font-semibold text-gray-700">Taux de décote annuels</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {pctField('depreciationRateYear1', 'Année 1')}
          {pctField('depreciationRateYear2', 'Année 2')}
          {pctField('depreciationRateYear3', 'Année 3')}
          {pctField('depreciationRateYears4to6', 'Années 4 à 6')}
          {pctField('depreciationRateAfter6', 'Après 6 ans')}
        </div>
      </div>

      <div>
        <p className="mb-3 text-xs font-semibold text-gray-700">Révision majeure (projection coûts)</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {numField('majorMaintenanceCost', 'Coût révision majeure estimée', '€ — ex : 1 500 € courroie + freins + pneus')}
          {numField('majorMaintenanceKm', 'Kilométrage déclencheur révision majeure', 'km — ex : 30 000 km')}
        </div>
        <p className="mt-2 text-[11px] text-gray-400 leading-relaxed">
          Ces valeurs anticipent les grandes révisions sur la projection ROI.
          Elles n'affectent pas l'historique réel — seuls les coûts saisis dans les fiches véhicules comptent pour la période passée.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {numField('roiAlertMonthsBefore', 'Seuil alerte "Revendre bientôt"', 'mois avant optimal')}
        {numField('roiCaMoyenMois', 'Mois d\'historique CA moyen', 'mois (1-24, défaut 5)')}
        {numField('roiHorizonMonths', 'Horizon courbe ROI', 'mois (12-120, défaut 48)')}
      </div>

      {/* Seuils km (Getaround) */}
      <div>
        <p className="mb-3 text-xs font-semibold text-gray-700">Seuils kilométrage</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {numField('kmDeclinCA', 'Km déclin CA', 'km — ex : 160 000')}
          {numField('kmStopGA', 'Km limite plateforme', 'km — ex : 200 000')}
          {numField('defaultDepreciationRate', 'Pente €/mois par défaut', '€/mois si aucun snapshot')}
        </div>
        <p className="mt-2 text-[11px] text-gray-400 leading-relaxed">
          Le CA projeté décroît linéairement entre km déclin et km limite, puis tombe à 0 (véhicule retiré).
          La pente €/mois est utilisée si aucun snapshot de valeur marchande n'est disponible.
        </p>
      </div>

      {/* Plateforme */}
      <div>
        <p className="mb-3 text-xs font-semibold text-gray-700">Plateforme</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Nom de la plateforme</label>
            <input type="text" placeholder="Getaround"
              value={platformName}
              onChange={e => setPlatformName(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Taux commission plateforme (ex: 1.2544)</label>
            <input type="number" min="1" max="2" step="0.0001"
              value={form.platformCommissionRate}
              onChange={e => setForm(f => ({ ...f, platformCommissionRate: parseFloat(e.target.value) || 1.2544 }))}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
            <p className="mt-1 text-[10px] text-gray-400">Divise le grossRevenue pour estimer l'ownerPayout. Défaut : 1.2544 (25,44 % Getaround).</p>
          </div>
        </div>
      </div>

      {/* Profil saisonnier */}
      <div>
        <div className="flex items-center gap-3 mb-3">
          <p className="text-xs font-semibold text-gray-700">Profil saisonnier</p>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={roiCoeffSaison !== null}
              onChange={e => setRoiCoeffSaison(e.target.checked ? new Array(12).fill(1.0) : null)}
              className="accent-[#01696e]" />
            <span className="text-xs text-gray-500">Activer</span>
          </label>
        </div>
        {roiCoeffSaison !== null && (
          <>
            <div className="grid grid-cols-6 gap-2">
              {MONTHS_FR.map((month, i) => (
                <div key={month}>
                  <label className="mb-1 block text-[10px] font-medium text-gray-500 text-center">{month}</label>
                  <input type="number" min="0.1" max="3" step="0.05"
                    value={roiCoeffSaison[i] ?? 1.0}
                    onChange={e => {
                      const updated = [...roiCoeffSaison];
                      updated[i] = parseFloat(e.target.value) || 1.0;
                      setRoiCoeffSaison(updated);
                    }}
                    className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-center text-xs outline-none focus:border-[#01696e]" />
                </div>
              ))}
            </div>
            <p className="mt-2 text-[10px] text-gray-400">
              Coefficients appliqués aux mois sans données réelles (1.0 = normal, 1.5 = +50%, 0.7 = -30%).
            </p>
          </>
        )}
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button type="button" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}
          className="rounded-xl px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
          style={{ backgroundColor: '#01696e' }}>
          {saveMut.isPending ? 'Enregistrement...' : 'Enregistrer'}
        </button>
        {saved && <p className="text-sm font-medium text-green-600">Sauvegardé ✓</p>}
      </div>
    </section>
  );
}

function IntelligenceSettingsSection(): React.JSX.Element {
  const qc = useQueryClient();
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<{ settings: CompanySettings }>('/settings').then(r => r.data.settings),
    staleTime: 5 * 60_000,
  });

  const [form, setForm] = React.useState({
    ratingDropThreshold: 0.0,
    underutilizationThreshold: 0.30,
    underutilizationWeeks: 4,
    riskScoreAlertThreshold: 60,
    riskWeightScore: 40,
    riskWeightFlags: 30,
    riskWeightCancelled: 20,
    riskWeightDelay: 10,
  });
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    if (settings) {
      setForm({
        ratingDropThreshold: settings.ratingDropThreshold ?? 0.0,
        underutilizationThreshold: settings.underutilizationThreshold ?? 0.30,
        underutilizationWeeks: settings.underutilizationWeeks ?? 4,
        riskScoreAlertThreshold: settings.riskScoreAlertThreshold ?? 60,
        riskWeightScore: settings.riskWeightScore ?? 40,
        riskWeightFlags: settings.riskWeightFlags ?? 30,
        riskWeightCancelled: settings.riskWeightCancelled ?? 20,
        riskWeightDelay: settings.riskWeightDelay ?? 10,
      });
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: (data: typeof form) => api.put('/settings', data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  const totalWeight = form.riskWeightScore + form.riskWeightFlags + form.riskWeightCancelled + form.riskWeightDelay;

  return (
    <div data-testid="intelligence-settings-section" className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="border-b border-gray-100 px-5 py-3">
        <h2 className="text-sm font-semibold text-gray-900">Intelligence — Alertes & Risque</h2>
        <p className="text-xs text-gray-400">Tous les seuils sont configurables. Aucune valeur codée en dur.</p>
      </div>
      <div className="p-5 space-y-5">
        {/* Alerte baisse note */}
        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Alerte baisse note Getaround</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-600">Seuil de baisse déclenchant l&apos;alerte (ex: 0.3)</span>
              <input data-testid="input-intelligence-ratingDropThreshold" type="number" step="0.1" min="0" max="5"
                value={form.ratingDropThreshold}
                onChange={e => setForm(f => ({ ...f, ratingDropThreshold: parseFloat(e.target.value) || 0 }))}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#01696e] focus:outline-none" />
              <span className="text-[10px] text-gray-400">0 = toute baisse, 0.3 = baisse d&apos;au moins 0.3 pt</span>
            </label>
          </div>
        </div>

        {/* Alerte sous-utilisation */}
        <div className="border-t border-gray-50 pt-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Alerte sous-utilisation véhicule</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-600">Taux d&apos;occupation minimum (%)</span>
              <input data-testid="input-intelligence-underutilizationThreshold" type="number" step="5" min="0" max="100"
                value={Math.round(form.underutilizationThreshold * 100)}
                onChange={e => setForm(f => ({ ...f, underutilizationThreshold: (parseFloat(e.target.value) || 0) / 100 }))}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#01696e] focus:outline-none" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-600">Fenêtre d&apos;analyse (semaines)</span>
              <input data-testid="input-intelligence-underutilizationWeeks" type="number" step="1" min="1" max="52"
                value={form.underutilizationWeeks}
                onChange={e => setForm(f => ({ ...f, underutilizationWeeks: parseInt(e.target.value) || 4 }))}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#01696e] focus:outline-none" />
            </label>
          </div>
        </div>

        {/* Score risque */}
        <div className="border-t border-gray-50 pt-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Score risque locataire</h3>
          <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-600">Seuil d&apos;alerte score risque (0-100)</span>
              <input data-testid="input-intelligence-riskScoreAlertThreshold" type="number" step="5" min="0" max="100"
                value={form.riskScoreAlertThreshold}
                onChange={e => setForm(f => ({ ...f, riskScoreAlertThreshold: parseInt(e.target.value) || 60 }))}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#01696e] focus:outline-none" />
            </label>
          </div>
          <p className="mb-2 text-xs font-medium text-gray-600">Pondérations (total actuel : <span className={totalWeight !== 100 ? 'text-red-600 font-bold' : 'text-green-600 font-bold'}>{totalWeight}</span> — doit être 100)</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {([ ['Score conducteur', 'riskWeightScore'], ['Flags', 'riskWeightFlags'], ['Annulations', 'riskWeightCancelled'], ['Délai réponse', 'riskWeightDelay'] ] as [string, keyof typeof form][]).map(([label, key]) => (
              <label key={key} className="flex flex-col gap-1">
                <span className="text-xs text-gray-600">{label}</span>
                <input data-testid={`input-intelligence-${key}`} type="number" step="5" min="0" max="100"
                  value={form[key]}
                  onChange={e => setForm(f => ({ ...f, [key]: parseInt(e.target.value) || 0 }))}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#01696e] focus:outline-none" />
              </label>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-gray-100 pt-4">
          {saved && <span className="text-xs font-medium text-green-600">Sauvegardé ✓</span>}
          {!saved && <span />}
          <button type="button" disabled={saveMutation.isPending}
            onClick={() => saveMutation.mutate(form)}
            className="rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 transition"
            style={{ backgroundColor: '#01696e' }}>
            {saveMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ComptabiliteSection(): React.JSX.Element {
  const qc = useQueryClient();
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<{ settings: CompanySettings }>('/settings').then(r => r.data.settings),
    staleTime: 5 * 60_000,
  });

  const [form, setForm] = React.useState({
    journalCode: 'VT',
    compteLocationsProduit: '706100',
    compteCompensationsProduit: '706200',
    compteEntretienCharge: '615000',
    compteAssuranceCharge: '616000',
    compteParkingCharge: '613000',
    formatExportPreference: 'fec',
    objectifSeuilAlerte: 80,
  });
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    if (settings) {
      setForm({
        journalCode: settings.journalCode ?? 'VT',
        compteLocationsProduit: settings.compteLocationsProduit ?? '706100',
        compteCompensationsProduit: settings.compteCompensationsProduit ?? '706200',
        compteEntretienCharge: settings.compteEntretienCharge ?? '615000',
        compteAssuranceCharge: settings.compteAssuranceCharge ?? '616000',
        compteParkingCharge: settings.compteParkingCharge ?? '613000',
        formatExportPreference: settings.formatExportPreference ?? 'fec',
        objectifSeuilAlerte: settings.objectifSeuilAlerte ?? 80,
      });
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: () => api.put('/settings', form),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  function field(key: keyof typeof form, label: string, hint?: string, type: 'text' | 'number' = 'text') {
    return (
      <div key={key}>
        <label className="mb-1 block text-xs font-medium text-gray-600">{label}</label>
        {hint && <p className="mb-1.5 text-[11px] text-gray-400">{hint}</p>}
        <input type={type} value={form[key]}
          onChange={e => setForm(f => ({ ...f, [key]: type === 'number' ? parseInt(e.target.value) || 0 : e.target.value }))}
          data-testid={`input-compta-${key}`}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
      </div>
    );
  }

  return (
    <section data-testid="comptabilite-section" className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">Comptabilité</h2>
        <p className="mt-0.5 text-xs text-gray-400">Configuration des exports FEC DGFiP et numéros de comptes</p>
      </div>

      <div>
        <p className="mb-3 text-xs font-semibold text-gray-700">Format d'export préféré</p>
        <div className="flex gap-3">
          {([['fec', 'FEC DGFiP'], ['csv', 'CSV brut']] as const).map(([v, lbl]) => (
            <label key={v} className="flex items-center gap-2 cursor-pointer select-none">
              <input type="radio" name="formatExport" value={v} checked={form.formatExportPreference === v}
                onChange={() => setForm(f => ({ ...f, formatExportPreference: v }))}
                className="accent-[#01696e]" />
              <span className="text-sm text-gray-700">{lbl}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {field('journalCode', 'Code journal', 'Préfixe des écritures FEC (ex : VT)')}
        {field('objectifSeuilAlerte', 'Seuil alerte objectif CA (%)', 'En dessous de ce % du CA cible, indicateur orange', 'number')}
      </div>

      <div>
        <p className="mb-3 text-xs font-semibold text-gray-700">Comptes de produits</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {field('compteLocationsProduit', 'Locations (produit)')}
          {field('compteCompensationsProduit', 'Compensations (produit)')}
        </div>
      </div>

      <div>
        <p className="mb-3 text-xs font-semibold text-gray-700">Comptes de charges</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {field('compteEntretienCharge', 'Entretien')}
          {field('compteAssuranceCharge', 'Assurance')}
          {field('compteParkingCharge', 'Parking')}
        </div>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}
          className="rounded-xl px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
          style={{ backgroundColor: '#01696e' }}>
          {saveMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
        </button>
        {saved && <p className="text-sm font-medium text-green-600">Sauvegardé ✓</p>}
      </div>
    </section>
  );
}

const FLAG_CONFIG = [
  { key: 'blocked_cleaning',   label: 'Nettoyage' },
  { key: 'blocked_damage',     label: 'Dommage' },
  { key: 'blocked_claim',      label: 'Sinistre' },
  { key: 'blocked_late',       label: 'Retard' },
  { key: 'blocked_infraction', label: 'Infraction' },
  { key: 'blocked_gas',        label: 'Carburant' },
] as const;

const DEFAULT_MALUS: Record<string, number> = {
  blocked_cleaning: 10, blocked_damage: 20, blocked_claim: 20,
  blocked_late: 5, blocked_infraction: 5, blocked_gas: 5,
};

function ExtraChargesSection(): React.JSX.Element {
  const qc = useQueryClient();
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<{ settings: CompanySettings }>('/settings').then(r => r.data.settings),
    staleTime: 5 * 60_000,
  });

  const [windowDays, setWindowDays] = React.useState(7);
  const [activeTypes, setActiveTypes] = React.useState<string[]>(FLAG_CONFIG.map(f => f.key));
  const [malus, setMalus] = React.useState<Record<string, number>>(DEFAULT_MALUS);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    if (settings) {
      setWindowDays(settings.invoiceSyncWindowDays ?? 7);
      setActiveTypes(settings.invoiceActiveTypes ?? FLAG_CONFIG.map(f => f.key));
      const cfg = settings.invoiceMalusConfig ?? {};
      setMalus({ ...DEFAULT_MALUS, ...cfg });
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: () => api.put('/settings', {
      invoiceSyncWindowDays: windowDays,
      invoiceActiveTypes: activeTypes,
      invoiceMalusConfig: malus,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  function toggleType(key: string): void {
    setActiveTypes(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  }

  return (
    <section data-testid="extra-charges-section" className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">Frais supplémentaires Getaround</h2>
        <p className="mt-0.5 text-xs text-gray-400">Détection des frais facturés aux locataires et impact sur le scoring</p>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold text-gray-700">Fenêtre de synchronisation (jours)</label>
        <p className="mb-2 text-[11px] text-gray-400">Durée de rétro-analyse des locations complétées lors du cron horaire</p>
        <input type="number" min={1} max={90} value={windowDays}
          onChange={e => setWindowDays(Math.max(1, parseInt(e.target.value, 10) || 7))}
          data-testid="input-invoice-sync-window"
          className="w-24 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold text-gray-700">Types de frais actifs</p>
        <p className="mb-3 text-[11px] text-gray-400">Les frais activés génèrent une alerte orange sur la location et un malus conducteur</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {FLAG_CONFIG.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={activeTypes.includes(key)} onChange={() => toggleType(key)}
                className="rounded accent-[#01696e]" />
              <span className="text-sm text-gray-700">{label}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold text-gray-700">Malus scoring par type (points)</p>
        <p className="mb-3 text-[11px] text-gray-400">Nombre de points déduits du score conducteur pour chaque type de frais non débloqué</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {FLAG_CONFIG.map(({ key, label }) => (
            <div key={key}>
              <label className="mb-1 block text-[11px] text-gray-500">{label}</label>
              <input type="number" min={0} max={100} value={malus[key] ?? DEFAULT_MALUS[key]}
                onChange={e => setMalus(m => ({ ...m, [key]: parseInt(e.target.value, 10) || 0 }))}
                data-testid={`input-malus-${key}`}
                className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-[#01696e]" />
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}
          className="rounded-xl px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
          style={{ backgroundColor: '#01696e' }}>
          {saveMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
        </button>
        {saved && <p className="text-sm font-medium text-green-600">Sauvegardé ✓</p>}
      </div>
    </section>
  );
}

export default function SettingsPage(): React.JSX.Element {
  useEffect(() => { void trackEvent('settings', 'view'); }, []);
  const qc = useQueryClient();
  const logoInputRef = useRef<HTMLInputElement>(null);

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<{ settings: CompanySettings }>('/settings').then(r => r.data.settings),
    staleTime: 5 * 60_000,
  });

  const [form, setForm] = useState({
    primaryColor: '#01696e',
    secondaryColor: '#f8f9fa',
    accentColor: '#ff6b35',
    logoUrl: '',
    fontFamily: 'Montserrat',
    aiModeCarSeat: 'approval',
    aiModeIncident: 'approval',
    aiModeGeneral: 'approval',
    aiTone: 'vouvoiement',
    aiName: 'Alex',
    messageUnansweredMinutes: null as number | null,
    threadAutoCloseDays: null as number | null,
  });

  const [saved, setSaved] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [activeTab, setActiveTab] = useState<'getaround' | 'equipe' | 'notifications' | 'messagerie' | 'vehicules' | 'comptabilite' | 'apparence'>('getaround');

  useEffect(() => {
    if (settings) {
      setForm({
        primaryColor: settings.primaryColor ?? '#01696e',
        secondaryColor: settings.secondaryColor ?? '#f8f9fa',
        accentColor: settings.accentColor ?? '#ff6b35',
        logoUrl: settings.logoUrl ?? '',
        fontFamily: settings.fontFamily ?? 'Montserrat',
        aiModeCarSeat: settings.aiModeCarSeat ?? 'approval',
        aiModeIncident: settings.aiModeIncident ?? 'approval',
        aiModeGeneral: settings.aiModeGeneral ?? 'approval',
        aiTone: settings.aiTone ?? 'vouvoiement',
        aiName: settings.aiName ?? 'Alex',
        messageUnansweredMinutes: settings.messageUnansweredMinutes ?? null,
        threadAutoCloseDays: settings.threadAutoCloseDays ?? null,
      });
      if (settings.logoUrl) setLogoPreview(settings.logoUrl);
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: (data: typeof form) => api.put('/settings', {
      primaryColor: data.primaryColor,
      secondaryColor: data.secondaryColor,
      accentColor: data.accentColor,
      logoUrl: data.logoUrl || undefined,
      fontFamily: data.fontFamily,
      aiModeCarSeat: data.aiModeCarSeat as 'auto' | 'approval' | 'manual',
      aiModeIncident: data.aiModeIncident as 'auto' | 'approval' | 'manual',
      aiModeGeneral: data.aiModeGeneral as 'auto' | 'approval' | 'manual',
      aiTone: data.aiTone as 'vouvoiement' | 'tutoiement',
      aiName: data.aiName,
      messageUnansweredMinutes: data.messageUnansweredMinutes,
      threadAutoCloseDays: data.threadAutoCloseDays,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  const autoCloseRunMutation = useMutation({
    mutationFn: () => api.post<{ success: boolean; closed: number; autoCloseDays: number }>('/messages/auto-close/run').then(r => r.data),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['inbox-summary'] }); void qc.invalidateQueries({ queryKey: ['messages'] }); },
  });

  async function handleLogoUpload(file: File): Promise<void> {
    setLogoUploading(true);
    try {
      const fd = new FormData();
      fd.append('logo', file);
      const res = await api.post<{ logoUrl: string }>('/settings/logo', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const url = res.data.logoUrl;
      setLogoPreview(url);
      setForm(f => ({ ...f, logoUrl: url }));
      void qc.invalidateQueries({ queryKey: ['settings'] });
    } catch {
      alert('Erreur lors de l\'upload du logo.');
    } finally {
      setLogoUploading(false);
    }
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    saveMutation.mutate(form);
  }

  const TABS: { id: typeof activeTab; label: string }[] = [
    { id: 'getaround',     label: 'Getaround' },
    { id: 'equipe',        label: 'Équipe' },
    { id: 'notifications', label: 'Notifications' },
    { id: 'messagerie',    label: 'Messagerie IA' },
    { id: 'vehicules',     label: 'Véhicules & ROI' },
    { id: 'comptabilite',  label: 'Comptabilité' },
    { id: 'apparence',     label: 'Apparence' },
  ];

  const SaveBtn = () => (
    <div className="flex items-center gap-3">
      <button type="submit" disabled={saveMutation.isPending}
        className="rounded-xl px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-60 transition"
        style={{ backgroundColor: '#01696e' }}>
        {saveMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
      </button>
      {saved && <p className="text-sm font-medium text-green-600">Paramètres sauvegardés ✓</p>}
      {saveMutation.isError && <p className="text-sm text-red-600">Erreur lors de la sauvegarde</p>}
    </div>
  );

  return (
    <div className="p-4 lg:p-6 max-w-3xl">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-gray-900">Paramètres</h1>
        <p className="text-sm text-gray-500">Configuration de votre espace de gestion</p>
      </div>

      {/* Onglets horizontaux */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex gap-1 overflow-x-auto">
          {TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors
                ${activeTab === tab.id
                  ? 'border-[#01696e] text-[#01696e]'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* ── GETAROUND ── */}
      {activeTab === 'getaround' && (
        <div className="space-y-6">
          <GetaroundSection />
        </div>
      )}

      {/* ── ÉQUIPE ── */}
      {activeTab === 'equipe' && (
        <div className="space-y-6">
          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900">Informations société</h2>
            <p className="mt-0.5 text-xs text-gray-400">Raison sociale, adresse et contacts de votre entreprise</p>
            <p className="mt-3 text-xs text-gray-400 italic">Ces informations sont gérées par le super admin depuis le tableau de bord SuperAdmin.</p>
          </section>
          <MonCompteSection />
          <UsersSection />
        </div>
      )}

      {/* ── NOTIFICATIONS ── */}
      {activeTab === 'notifications' && (
        <div className="space-y-6">
          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">Tableau de bord TV</p>
                <p className="text-xs text-gray-400 mt-0.5">Affichage plein écran pour moniteur ou TV de bureau</p>
              </div>
              <a href="/tv" target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                Ouvrir le TV
              </a>
            </div>
          </section>
          <AlertEmailsSection />
          <TelegramSection />
          <SlackSection />
        </div>
      )}

      {/* ── MESSAGERIE IA ── */}
      {activeTab === 'messagerie' && (
        <form onSubmit={handleSubmit} className="space-y-6">
          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-5">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Messagerie automatique</h2>
              <p className="text-xs text-gray-400 mt-0.5">Définissez comment l'IA gère chaque type de message</p>
            </div>

            <ModeSelector label="Demandes de siège auto"
              value={form.aiModeCarSeat}
              onChange={v => { const u = { ...form, aiModeCarSeat: v }; setForm(u); saveMutation.mutate(u); }} />

            <ModeSelector label="Signalements d'incidents"
              value={form.aiModeIncident}
              onChange={v => { const u = { ...form, aiModeIncident: v }; setForm(u); saveMutation.mutate(u); }} />

            <ModeSelector label="Messages généraux"
              value={form.aiModeGeneral}
              onChange={v => { const u = { ...form, aiModeGeneral: v }; setForm(u); saveMutation.mutate(u); }} />

            <div>
              <p className="mb-2 text-xs font-semibold text-gray-700">Ton des réponses</p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { value: 'vouvoiement', label: 'Vouvoiement', desc: 'Ton formel et professionnel' },
                  { value: 'tutoiement', label: 'Tutoiement', desc: 'Ton plus proche et détendu' },
                ].map(t => (
                  <button key={t.value} type="button" onClick={() => { const u = { ...form, aiTone: t.value }; setForm(u); saveMutation.mutate(u); }}
                    className={`rounded-xl border p-4 text-left transition ${form.aiTone === t.value ? 'border-[#01696e] bg-[#01696e]/5' : 'border-gray-200 hover:border-gray-300'}`}>
                    <p className={`text-sm font-semibold ${form.aiTone === t.value ? 'text-[#01696e]' : 'text-gray-800'}`}>{t.label}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{t.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-700">Prénom de l'assistant IA</label>
              <p className="mb-2 text-[11px] text-gray-400">Ce prénom sera utilisé dans les signatures de messages générés par l'IA</p>
              <input type="text" value={form.aiName}
                onChange={e => setForm(f => ({ ...f, aiName: e.target.value }))}
                maxLength={20} pattern="[a-zA-ZÀ-ÿ]+" placeholder="Alex"
                className="w-40 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e] focus:ring-2 focus:ring-[#01696e]/20" />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-700">Délai avant alerte message sans réponse</label>
              <p className="mb-2 text-[11px] text-gray-400">Délai en minutes après lequel un message inbound sans réponse est signalé (défaut : 30 min)</p>
              <div className="flex items-center gap-2">
                <input type="number" min={5} max={240} step={5}
                  value={form.messageUnansweredMinutes ?? ''}
                  onChange={e => setForm(f => ({ ...f, messageUnansweredMinutes: e.target.value ? parseInt(e.target.value, 10) : null }))}
                  placeholder="30"
                  className="w-24 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e] focus:ring-2 focus:ring-[#01696e]/20" />
                <span className="text-xs text-gray-400">minutes (défaut : 30 min)</span>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-700">Auto-clôture des fils non répondus</label>
              <p className="mb-2 text-[11px] text-gray-400">
                Jours après la fin d'une location au-delà desquels un fil non répondu est clôturé automatiquement
                (défaut : 7 jours). Le locataire peut toujours réouvrir le fil en réécrivant.
              </p>
              <div className="flex items-center gap-2">
                <input type="number" min={1} max={90} step={1}
                  value={form.threadAutoCloseDays ?? ''}
                  onChange={e => setForm(f => ({ ...f, threadAutoCloseDays: e.target.value ? parseInt(e.target.value, 10) : null }))}
                  placeholder="7"
                  className="w-24 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e] focus:ring-2 focus:ring-[#01696e]/20" />
                <span className="text-xs text-gray-400">jours (défaut : 7 jours)</span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <button type="button"
                  onClick={() => autoCloseRunMutation.mutate()}
                  disabled={autoCloseRunMutation.isPending}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                  {autoCloseRunMutation.isPending ? 'Clôture en cours...' : 'Forcer la clôture auto maintenant'}
                </button>
                {autoCloseRunMutation.data && (
                  <span className="text-xs text-gray-400">
                    {autoCloseRunMutation.data.closed} fil(s) clôturé(s) (seuil : {autoCloseRunMutation.data.autoCloseDays} j)
                  </span>
                )}
              </div>
            </div>
          </section>

          <ICalSection />
          <SaveBtn />
        </form>
      )}

      {/* ── VÉHICULES & ROI ── */}
      {activeTab === 'vehicules' && (
        <div className="space-y-6">
          <VehicleSettingsSection />
          <ReventeDecoteSection />
          <IntelligenceSettingsSection />
        </div>
      )}

      {/* ── COMPTABILITÉ ── */}
      {activeTab === 'comptabilite' && (
        <div className="space-y-6">
          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Export & comptabilité</h2>
                <p className="mt-0.5 text-xs text-gray-400">Exports CSV, rapports mensuels, relevés propriétaires</p>
              </div>
              <Link to="/export"
                className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition">
                Aller aux exports
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          </section>
          <ExtraChargesSection />
          <ComptabiliteSection />
          <BillingSection />
        </div>
      )}

      {/* ── APPARENCE ── */}
      {activeTab === 'apparence' && (
        <form onSubmit={handleSubmit} className="space-y-6">
          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
            <h2 className="text-sm font-semibold text-gray-900">Apparence</h2>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-600">Police</label>
              <select value={form.fontFamily}
                onChange={e => {
                  const f = e.target.value;
                  setForm(prev => ({ ...prev, fontFamily: f }));
                  const applyThemeFn = (window as unknown as Record<string, unknown>).applyTheme as ((s: { fontFamily: string }) => void) | undefined;
                  applyThemeFn?.({ fontFamily: f });
                }}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]"
                style={{ fontFamily: form.fontFamily }}>
                {GOOGLE_FONTS.map(f => (
                  <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
                ))}
              </select>
              <p className="mt-0.5 text-[11px] text-gray-400">Prévisualisation en temps réel — Enregistrer pour appliquer définitivement</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              {[
                { key: 'primaryColor', label: 'Couleur principale' },
                { key: 'secondaryColor', label: 'Couleur secondaire' },
                { key: 'accentColor', label: "Couleur d'accent" },
              ].map(({ key, label }) => (
                <div key={key}>
                  <label className="mb-1.5 block text-xs font-medium text-gray-600">{label}</label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={(form as unknown as Record<string, string>)[key]}
                      onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                      className="h-9 w-12 cursor-pointer rounded border border-gray-200 p-0.5" />
                    <input type="text" value={(form as unknown as Record<string, string>)[key]}
                      onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                      className="flex-1 rounded-lg border border-gray-200 px-2.5 py-2 font-mono text-xs outline-none focus:border-[#01696e]"
                      pattern="^#[0-9a-fA-F]{6}$" />
                  </div>
                </div>
              ))}
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-600">Logo</label>
              <div className="flex items-center gap-3">
                {logoPreview && (
                  <img src={logoPreview} alt="Logo"
                    className="h-20 rounded-lg border border-gray-200 object-contain p-1" style={{ maxHeight: 80 }} />
                )}
                <div className="flex flex-col gap-2">
                  <button type="button" onClick={() => logoInputRef.current?.click()} disabled={logoUploading}
                    className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    {logoUploading ? 'Upload en cours...' : 'Choisir un fichier'}
                  </button>
                  <p className="text-[11px] text-gray-400">PNG, JPG ou SVG — max 5 Mo</p>
                </div>
                <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/svg+xml" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) void handleLogoUpload(f); }} />
              </div>
            </div>
          </section>

          <FeedbackSection />
          <SaveBtn />
        </form>
      )}
    </div>
  );
}
