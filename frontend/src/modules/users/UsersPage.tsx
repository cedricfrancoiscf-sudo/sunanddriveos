import React, { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { api } from '../../utils/api';

interface User {
  id: string; name: string; email: string; role: string; roles: string[];
  isActive: boolean; lastLoginAt: string | null; createdAt: string;
}

// ─── Rôles disponibles ────────────────────────────────────────────────────────

const ROLES_CONFIG = [
  { value: 'admin',        label: 'Administrateur', color: 'text-green-700' },
  { value: 'carkeeper',   label: 'Car Keeper',     color: 'text-blue-700'  },
  { value: 'exploitation', label: 'Exploitation',   color: 'text-orange-700' },
  { value: 'comptable',   label: 'Comptable',      color: 'text-purple-700' },
] as const;

const ALL_ROLES_KEYS = ['admin', 'exploitation', 'comptable', 'carkeeper', 'third_party_owner'] as const;
const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrateur', carkeeper: 'Car Keeper',
  exploitation: 'Exploitation', comptable: 'Comptable', third_party_owner: 'Propriétaire tiers',
};

// ─── Composant RoleMultiSelect ────────────────────────────────────────────────

function RoleMultiSelect({ userId, currentRoles, onSave, isLastAdmin }: {
  userId: string;
  currentRoles: string[];
  onSave: (userId: string, roles: string[]) => void;
  isLastAdmin: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(currentRoles);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelected(currentRoles);
  }, [currentRoles.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function toggle(role: string): void {
    if (role === 'admin' && isLastAdmin && selected.includes('admin')) return;
    const next = selected.includes(role)
      ? selected.filter(r => r !== role)
      : [...selected, role];
    if (next.length === 0) return;
    setSelected(next);
    onSave(userId, next);
  }

  const label = ROLES_CONFIG
    .filter(r => selected.includes(r.value))
    .map(r => r.label)
    .join(', ') || 'Sélectionner';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:border-[#01696e] min-w-[200px] justify-between transition-colors"
      >
        <span className="truncate max-w-[170px] text-left">{label}</span>
        <span className="text-gray-400 text-xs shrink-0">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-52 rounded-xl border border-gray-200 bg-white shadow-lg py-1">
          {ROLES_CONFIG.map(role => (
            <label
              key={role.value}
              className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-gray-50 select-none"
            >
              <input
                type="checkbox"
                checked={selected.includes(role.value)}
                onChange={() => toggle(role.value)}
                className="rounded accent-[#01696e]"
              />
              <span className={`text-sm font-medium ${role.color}`}>{role.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Page principale ──────────────────────────────────────────────────────────

const EMPTY_INVITE = { email: '', name: '', roles: ['exploitation'] as string[] };

export default function UsersPage(): React.JSX.Element {
  const qc = useQueryClient();
  const [showInvite, setShowInvite] = useState(false);
  const [form, setForm] = useState(EMPTY_INVITE);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);

  const { data: rawUsers = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<{ users: User[] }>('/users').then(r => r.data.users),
    staleTime: 5 * 60_000,
  });

  type UserSortKey = 'name' | 'lastLoginAt' | 'isActive';
  const [userSortKey, setUserSortKey] = useState<UserSortKey>('name');
  const [userSortDir, setUserSortDir] = useState<'asc' | 'desc'>('asc');

  function toggleUserSort(k: UserSortKey) {
    if (userSortKey === k) setUserSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setUserSortKey(k); setUserSortDir('asc'); }
  }

  function UserSortTh({ k, label }: { k: UserSortKey; label: string }): React.JSX.Element {
    const active = userSortKey === k;
    return (
      <th className={`px-4 py-3 text-left text-xs font-semibold cursor-pointer select-none hover:text-gray-800 transition-colors ${active ? 'text-[#01696e]' : 'text-gray-500'}`}
        onClick={() => toggleUserSort(k)}>
        {label}{active ? (userSortDir === 'desc' ? ' ↓' : ' ↑') : ' ↕'}
      </th>
    );
  }

  const users = [...rawUsers].sort((a, b) => {
    let cmp = 0;
    if (userSortKey === 'name') cmp = a.name.localeCompare(b.name, 'fr');
    else if (userSortKey === 'lastLoginAt') {
      const aT = a.lastLoginAt ? new Date(a.lastLoginAt).getTime() : 0;
      const bT = b.lastLoginAt ? new Date(b.lastLoginAt).getTime() : 0;
      cmp = aT - bT;
    } else if (userSortKey === 'isActive') cmp = (a.isActive ? 1 : 0) - (b.isActive ? 1 : 0);
    return userSortDir === 'desc' ? -cmp : cmp;
  });

  const inviteMutation = useMutation({
    mutationFn: (body: typeof EMPTY_INVITE) => api.post<{ user: User; inviteUrl: string }>('/users/invite', {
      email: body.email,
      name: body.name,
      role: body.roles[0] ?? 'exploitation',
      roles: body.roles,
    }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['users'] });
      setInviteLink(res.data.inviteUrl);
      setForm(EMPTY_INVITE);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: string; role?: string; isActive?: boolean }) =>
      api.put(`/users/${id}`, data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['users'] }),
  });

  const rolesMutation = useMutation({
    mutationFn: ({ id, roles }: { id: string; roles: string[] }) =>
      api.put(`/users/${id}/roles`, { roles }),
    onSuccess: () => {
      setRoleError(null);
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } }).response?.data?.error;
      setRoleError(msg ?? 'Erreur lors de la modification des rôles');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/users/${id}`),
    onSuccess: () => { setDeleteError(null); void qc.invalidateQueries({ queryKey: ['users'] }); },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } }).response?.data?.error;
      setDeleteError(msg ?? 'Erreur lors de la suppression');
    },
  });

  function handleSaveRoles(userId: string, roles: string[]): void {
    const otherAdmins = users.filter(u => u.id !== userId && (u.roles?.includes('admin') || u.role === 'admin'));
    if (!roles.includes('admin') && otherAdmins.length === 0) {
      setRoleError('Impossible de retirer Admin — dernier administrateur');
      return;
    }
    rolesMutation.mutate({ id: userId, roles });
  }

  function handleInvite(e: React.FormEvent): void {
    e.preventDefault();
    inviteMutation.mutate(form);
  }

  const isLastAdminFn = (userId: string) => {
    const admins = users.filter(u => u.roles?.includes('admin') || u.role === 'admin');
    return admins.length <= 1 && admins[0]?.id === userId;
  };

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
                  className="shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50">Copier</button>
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
                  <label className="mb-1 block text-xs font-medium text-gray-600">Rôles *</label>
                  <RoleMultiSelect
                    userId=""
                    currentRoles={form.roles}
                    onSave={(_, roles) => setForm(f => ({ ...f, roles }))}
                    isLastAdmin={false}
                  />
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
                <UserSortTh k="name" label="Membre" />
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Rôles</th>
                <th className="hidden px-4 py-3 text-left text-xs font-semibold cursor-pointer select-none sm:table-cell" onClick={() => toggleUserSort('lastLoginAt')} style={{ color: userSortKey === 'lastLoginAt' ? '#01696e' : '' }}>Dernière connexion{userSortKey === 'lastLoginAt' ? (userSortDir === 'desc' ? ' ↓' : ' ↑') : ' ↕'}</th>
                <UserSortTh k="isActive" label="Statut" />
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
                    <RoleMultiSelect
                      userId={u.id}
                      currentRoles={u.roles?.length ? u.roles : [u.role]}
                      onSave={handleSaveRoles}
                      isLastAdmin={isLastAdminFn(u.id)}
                    />
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
