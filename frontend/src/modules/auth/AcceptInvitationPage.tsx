import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { api } from '../../utils/api';

export default function AcceptInvitationPage(): React.JSX.Element {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const slug = params.get('slug') ?? (import.meta.env.VITE_COMPANY_SLUG as string) ?? 'sun-and-drive';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (password !== confirm) { setError('Les mots de passe ne correspondent pas'); return; }
    if (!token) { setError('Lien d\'invitation invalide'); return; }
    setLoading(true);
    setError('');
    try {
      await api.post('/users/accept-invitation', { token, password, companySlug: slug });
      setDone(true);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError((err.response?.data as { error?: string })?.error ?? 'Erreur lors de l\'activation');
      } else {
        setError('Erreur lors de l\'activation');
      }
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
        <div className="text-center">
          <p className="text-red-600 font-medium">Lien d'invitation invalide ou expiré.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl"
            style={{ backgroundColor: '#01696e' }}>
            <span className="text-xl font-bold text-white">S</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">SunanddriveOS</h1>
          <p className="mt-1 text-sm text-gray-500">Activez votre compte</p>
        </div>

        {done ? (
          <div className="rounded-2xl border border-green-200 bg-green-50 p-6 text-center">
            <svg className="mx-auto mb-3 h-10 w-10 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="font-semibold text-green-800">Compte activé !</p>
            <p className="mt-1 text-sm text-green-600">Vous pouvez maintenant vous connecter.</p>
            <button type="button" onClick={() => navigate('/login')}
              className="mt-4 w-full rounded-xl py-2.5 text-sm font-semibold text-white transition"
              style={{ backgroundColor: '#01696e' }}>
              Se connecter
            </button>
          </div>
        ) : (
          <form onSubmit={e => void handleSubmit(e)}
            className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-gray-700">Mot de passe</label>
              <input type="password" required minLength={8} value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-[#01696e] focus:ring-1 focus:ring-[#01696e]"
                placeholder="Minimum 8 caractères" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-gray-700">Confirmer le mot de passe</label>
              <input type="password" required minLength={8} value={confirm}
                onChange={e => setConfirm(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-[#01696e] focus:ring-1 focus:ring-[#01696e]"
                placeholder="Retapez votre mot de passe" />
            </div>
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
            <button type="submit" disabled={loading}
              className="w-full rounded-xl py-3 text-sm font-semibold text-white transition disabled:opacity-60"
              style={{ backgroundColor: '#01696e' }}>
              {loading ? 'Activation...' : 'Activer mon compte'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
