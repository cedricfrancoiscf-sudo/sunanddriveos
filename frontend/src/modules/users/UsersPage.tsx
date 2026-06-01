import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { api } from '../../utils/api';

interface User {
  id: string; name: string; email: string; role: string; roles: string[];
  isActive: boolean; lastLoginAt: string | null; createdAt: string;
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrateur',
  carkeeper: 'Car Keeper',
  exploitation: 'Exploitation',
  comptable: 'Comptable',
};

const ROLES: Record<string, string> = {
  admin: 'Admin', exploitation: 'Exploitation', comptable: 'Comptable',
  carkeeper: 'Car Keeper', third_party_owner: 'Propriétaire tiers',
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
  const [roleError, setRoleError] = useState<string | null>(null);

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: string; role?: string; isActive?: boolean }) =>
      api.put(`/users/${id}`, data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['users'] }),
  });

  const rolesMutation = useMutation({
    mutationFn: ({ id, roles }: { id: string; roles: string[] }) =>
      api.put(`/users/${id}/roles`, { roles }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['users'] }),
  });

  function handleRoleToggle(userId: string, role: string, currentRoles: string[]): void {
    const isChecked = currentRoles.includes(role);
    setRoleError(null);

    if (isChecked) {
      if (role === 'admin') {
        const otherAdmins = users.filter(u =>
          u.id !== userId && (u.roles?.includes('admin') || u.role === 'admin')
        );
        if (otherAdmins.length === 0) {
          setRoleError('Impossible de retirer Admin — dernier administrateur');
          return;
        }
      }
      const newRoles = currentRoles.filter(r => r !== role);
      if (newRoles.length === 0) {
        setRoleError('Un utilisateur doit avoir au moins un rôle');
        return;
      }
      rolesMutation.mutate({ id: userId, roles: newRoles });
    } else {
      rolesMutation.mutate({ id: userId, roles: [...new Set([...currentRoles, role])] });
    }
  }

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

      {roleError && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {roleError}
          <button type="button" onClick={() => setRoleError(null)} className="ml-2 text-red-400 hover:text-red-600">✕</button>
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
                    <div className="flex flex-col gap-1">
                      {['admin', 'carkeeper', 'exploitation', 'comptable'].map(role => (
                        <label key={role} className="flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={u.roles?.includes(role) || u.role === role}
                            onChange={() => handleRoleToggle(u.id, role, u.roles?.length ? u.roles : [u.role])}
                            className="h-3.5 w-3.5 rounded border-gray-300 accent-[#01696e]"
                          />
                          <span className="text-xs text-gray-700">{ROLE_LABELS[role]}</span>
                        </label>
                      ))}
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
