import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { api } from '../../utils/api';

interface User {
  id: string; name: string; email: string; role: string; roles: string[];
  isActive: boolean; lastLoginAt: string | null; createdAt: string;
}

const MULTI_ROLE_OPTIONS = [
  { key: 'admin', label: 'Administrateur' },
  { key: 'carkeeper', label: 'Carkeeper' },
  { key: 'viewer', label: 'Lecteur' },
] as const;

const ROLES: Record<string, string> = {
  admin: 'Admin', exploitation: 'Exploitation', comptable: 'Comptable',
  carkeeper: 'Car Keeper', third_party_owner: 'Propriétaire tiers',
};

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-[#01696e]/10 text-[#01696e]',
  exploitation: 'bg-blue-50 text-blue-700',
  comptable: 'bg-purple-50 text-purple-700',
  carkeeper: 'bg-orange-50 text-orange-700',
  third_party_owner: 'bg-gray-100 text-gray-600',
};

const ROLE_KEYS = ['admin', 'exploitation', 'comptable', 'carkeeper', 'third_party_owner'] as const;

const EMPTY_INVITE = { email: '', name: '', role: 'exploitation' };

export default function UsersPage(): React.JSX.Element {
  const qc = useQueryClient();
  const [showInvite, setShowInvite] = useState(false);
  const [form, setForm] = useState(EMPTY_INVITE);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<{ users: User[] }>('/users').then(r => r.data.users),
    staleTime: 5 * 60_000,
  });

  const inviteMutation = useMutation({
    mutationFn: (body: typeof EMPTY_INVITE) => api.post<{ user: User; inviteUrl: string }>('/users/invite', body),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['users'] });
      setInviteLink(res.data.inviteUrl);
      setForm(EMPTY_INVITE);
    },
  });

  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [rolesModal, setRolesModal] = useState<{ userId: string; name: string; roles: string[] } | null>(null);
  const [pendingRoles, setPendingRoles] = useState<string[]>([]);

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: string; role?: string; isActive?: boolean }) =>
      api.put(`/users/${id}`, data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['users'] }),
  });

  const rolesMutation = useMutation({
    mutationFn: ({ id, roles }: { id: string; roles: string[] }) =>
      api.put(`/users/${id}/roles`, { roles }),
    onSuccess: () => {
      setRolesModal(null);
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/users/${id}`),
    onSuccess: () => {
      setDeleteError(null);
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } }).response?.data?.error;
      setDeleteError(msg ?? 'Erreur lors de la suppression');
    },
  });

  function handleInvite(e: React.FormEvent): void {
    e.preventDefault();
    inviteMutation.mutate(form);
  }

  return (
    <div className="p-4 lg:p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Utilisateurs</h1>
          <p className="text-sm text-gray-500">{users.length} membre{users.length !== 1 ? 's' : ''}</p>
        </div>
        <button type="button" onClick={() => { setShowInvite(true); setInviteLink(null); }}
          className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white" style={{ backgroundColor: '#01696e' }}>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Inviter
        </button>
      </div>

      {/* Formulaire invitation */}
      {showInvite && (
        <div className="mb-6 rounded-2xl border border-[#01696e]/20 bg-[#01696e]/5 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-900">Inviter un membre</h2>
          {inviteLink ? (
            <div className="space-y-3">
              <p className="text-sm text-gray-700">Invitation créée. Copiez ce lien et envoyez-le à l'utilisateur :</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-lg bg-white border border-gray-200 px-3 py-2 text-xs text-gray-700 break-all">{inviteLink}</code>
                <button type="button" onClick={() => void navigator.clipboard.writeText(inviteLink)}
                  className="shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50">
                  Copier
                </button>
              </div>
              <button type="button" onClick={() => { setShowInvite(false); setInviteLink(null); }}
                className="text-sm text-[#01696e] hover:underline">Fermer</button>
            </div>
          ) : (
            <form onSubmit={handleInvite} className="space-y-3">
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
                  <label className="mb-1 block text-xs font-medium text-gray-600">Rôle *</label>
                  <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#01696e]">
                    {ROLE_KEYS.map(r => <option key={r} value={r}>{ROLES[r]}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={inviteMutation.isPending}
                  className="rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" style={{ backgroundColor: '#01696e' }}>
                  {inviteMutation.isPending ? 'Envoi...' : 'Envoyer l\'invitation'}
                </button>
                <button type="button" onClick={() => setShowInvite(false)}
                  className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Annuler</button>
              </div>
              {inviteMutation.isError && <p className="text-xs text-red-600">Erreur lors de l'invitation</p>}
            </form>
          )}
        </div>
      )}

      {/* Modal rôles multiples */}
      {rolesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-xs rounded-2xl border border-gray-200 bg-white p-6 shadow-xl space-y-4">
            <h3 className="text-sm font-semibold text-gray-900">Rôles de {rolesModal.name}</h3>
            <div className="space-y-2">
              {MULTI_ROLE_OPTIONS.map(({ key, label }) => (
                <label key={key} className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={pendingRoles.includes(key)}
                    onChange={e => setPendingRoles(prev =>
                      e.target.checked ? [...prev, key] : prev.filter(r => r !== key)
                    )}
                    className="h-4 w-4 rounded border-gray-300 text-[#01696e]" />
                  <span className="text-sm text-gray-700">{label}</span>
                </label>
              ))}
            </div>
            {pendingRoles.length === 0 && (
              <p className="text-xs text-red-500">Au moins un rôle requis</p>
            )}
            <div className="flex gap-2 pt-1">
              <button type="button"
                disabled={pendingRoles.length === 0 || rolesMutation.isPending}
                onClick={() => rolesMutation.mutate({ id: rolesModal.userId, roles: pendingRoles })}
                className="flex-1 rounded-xl py-2 text-sm font-semibold text-white disabled:opacity-60"
                style={{ backgroundColor: '#01696e' }}>
                {rolesMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
              </button>
              <button type="button" onClick={() => setRolesModal(null)}
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteError && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {deleteError}
          <button type="button" onClick={() => setDeleteError(null)} className="ml-2 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {/* Liste */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" style={{ borderColor: '#01696e', borderTopColor: 'transparent' }} />
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Membre</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Rôle</th>
                <th className="hidden px-4 py-3 text-left text-xs font-semibold text-gray-500 sm:table-cell">Dernière connexion</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Statut</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{u.name}</p>
                    <p className="text-xs text-gray-400">{u.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1">
                      <select value={u.role}
                        onChange={e => updateMutation.mutate({ id: u.id, role: e.target.value })}
                        className={`rounded-full px-2.5 py-1 text-xs font-medium border-0 outline-none cursor-pointer ${ROLE_COLORS[u.role] ?? 'bg-gray-100 text-gray-600'}`}>
                        {ROLE_KEYS.map(r => <option key={r} value={r}>{ROLES[r]}</option>)}
                      </select>
                      {(u.roles ?? []).filter(r => r !== u.role).map(r => (
                        <span key={r} className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">+{r}</span>
                      ))}
                      <button type="button" title="Modifier les rôles"
                        onClick={() => { setRolesModal({ userId: u.id, name: u.name, roles: u.roles ?? [] }); setPendingRoles(u.roles ?? []); }}
                        className="rounded p-0.5 text-gray-300 hover:text-[#01696e] transition-colors">
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                    </div>
                  </td>
                  <td className="hidden px-4 py-3 text-xs text-gray-400 sm:table-cell">
                    {u.lastLoginAt ? format(new Date(u.lastLoginAt), 'dd/MM/yyyy HH:mm', { locale: fr }) : 'Jamais'}
                  </td>
                  <td className="px-4 py-3">
                    <button type="button"
                      onClick={() => updateMutation.mutate({ id: u.id, isActive: !u.isActive })}
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition ${u.isActive ? 'bg-green-50 text-green-700 hover:bg-green-100' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${u.isActive ? 'bg-green-500' : 'bg-gray-400'}`} />
                      {u.isActive ? 'Actif' : 'Inactif'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <span className="text-xs text-gray-400">
                        {format(new Date(u.createdAt), 'dd/MM/yy', { locale: fr })}
                      </span>
                      <button
                        type="button"
                        title="Supprimer"
                        disabled={deleteMutation.isPending}
                        onClick={() => {
                          if (window.confirm(`Êtes-vous sûr de vouloir supprimer ${u.name} ?`)) {
                            deleteMutation.mutate(u.id);
                          }
                        }}
                        className="rounded p-1 text-gray-300 hover:text-red-500 disabled:opacity-40 transition-colors"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
