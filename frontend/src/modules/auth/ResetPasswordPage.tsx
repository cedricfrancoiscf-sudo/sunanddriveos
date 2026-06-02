import React, { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { api } from '../../utils/api';

export default function ResetPasswordPage(): React.JSX.Element {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') ?? '';
  const slug = searchParams.get('slug') ?? '';

  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token || !slug) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="text-center space-y-3">
          <p className="text-gray-700">Lien invalide ou expiré.</p>
          <Link to="/login" className="text-sm text-[#01696e] hover:underline">Retour à la connexion</Link>
        </div>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (newPassword !== confirm) { setError('Les mots de passe ne correspondent pas.'); return; }
    if (newPassword.length < 8) { setError('Le mot de passe doit contenir au moins 8 caractères.'); return; }
    setLoading(true);
    setError(null);
    try {
      await api.post('/auth/reset-password', { token, companySlug: slug, newPassword });
      navigate('/login', { state: { message: 'Mot de passe mis à jour. Connectez-vous.' } });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } }).response?.data?.error;
      setError(msg ?? 'Lien invalide ou expiré.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl shadow-md" style={{ backgroundColor: '#01696e' }}>
            <span className="text-2xl font-bold text-white">S</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Nouveau mot de passe</h1>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Nouveau mot de passe</label>
              <input required type="password" minLength={8} value={newPassword} onChange={e => setNewPassword(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#01696e] focus:ring-2 focus:ring-[#01696e]/20"
                placeholder="Minimum 8 caractères" />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Confirmer le mot de passe</label>
              <input required type="password" minLength={8} value={confirm} onChange={e => setConfirm(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#01696e] focus:ring-2 focus:ring-[#01696e]/20"
                placeholder="Répétez le mot de passe" />
            </div>

            <button type="submit" disabled={loading}
              className="w-full rounded-lg py-2.5 text-sm font-semibold text-white transition disabled:opacity-60"
              style={{ backgroundColor: '#01696e' }}>
              {loading ? 'Mise à jour...' : 'Mettre à jour le mot de passe'}
            </button>
          </form>
        </div>

        <div className="mt-4 text-center">
          <Link to="/login" className="text-sm text-gray-500 hover:text-gray-700">← Retour à la connexion</Link>
        </div>
      </div>
    </div>
  );
}
