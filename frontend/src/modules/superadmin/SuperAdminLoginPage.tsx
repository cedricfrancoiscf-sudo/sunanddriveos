import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { setSuperAdminSession } from './superadminApi';
import axios from 'axios';

export default function SuperAdminLoginPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const base = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
      const res = await axios.post<{ token: string; user: { id: string; name: string; email: string } }>(
        `${base}/api/v1/auth/superadmin/login`,
        { email, password },
      );
      setSuperAdminSession(res.data.token, res.data.user);
      navigate('/superadmin');
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err)
        ? ((err.response?.data as { error?: string })?.error ?? 'Erreur de connexion')
        : 'Erreur de connexion';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl" style={{ backgroundColor: '#01696e' }}>
            <svg className="h-7 w-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-white">SunanddriveOS</h1>
          <p className="mt-1 text-sm text-gray-400">Super Administration</p>
        </div>

        <div className="rounded-2xl border border-gray-800 bg-gray-900 p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Email</label>
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full rounded-xl border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#01696e]/50"
                placeholder="admin@sunanddrive.com"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Mot de passe</label>
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-gray-700 bg-gray-800 px-4 py-2.5 pr-10 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#01696e]/50"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d={showPwd
                        ? "M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                        : "M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"}
                    />
                  </svg>
                </button>
              </div>
            </div>

            {error && (
              <p className="rounded-lg border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-400">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl py-2.5 text-sm font-semibold text-white transition-opacity disabled:opacity-60"
              style={{ backgroundColor: '#01696e' }}
            >
              {loading ? 'Connexion…' : 'Se connecter'}
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-xs text-gray-600">
          <a href="/login" className="hover:text-gray-400 transition-colors">← Retour à la connexion standard</a>
        </p>
      </div>
    </div>
  );
}
