import React, { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import axios from 'axios';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';

const SLUG = 'sun-and-drive';
const API_BASE = import.meta.env.VITE_API_URL as string | undefined ?? '';

interface BrandData { logoUrl: string | null; companyName: string | null; primaryColor: string }

async function fetchBrand(): Promise<BrandData> {
  const res = await fetch(`${API_BASE}/public/brand?slug=${SLUG}`);
  if (!res.ok) return { logoUrl: null, companyName: null, primaryColor: '#01696e' };
  return res.json() as Promise<BrandData>;
}

interface LocationState {
  from?: { pathname: string };
}

export default function LoginPage(): React.JSX.Element {
  const { login, isLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as LocationState)?.from?.pathname ?? '/dashboard';

  const { data: brand } = useQuery<BrandData>({
    queryKey: ['public-brand', SLUG],
    queryFn: fetchBrand,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);

    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err)
        ? ((err.response?.data as { error?: string })?.error ?? 'Erreur de connexion')
        : 'Erreur de connexion';
      setError(msg);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 text-center">
          {brand?.logoUrl ? (
            <img
              src={brand.logoUrl}
              alt={brand.companyName ?? 'Logo'}
              className="mx-auto mb-4 h-16 max-w-[180px] object-contain"
              onError={e => {
                const target = e.currentTarget;
                target.style.display = 'none';
                const fallback = target.nextElementSibling as HTMLElement | null;
                if (fallback) fallback.style.display = 'flex';
              }}
            />
          ) : null}
          <div
            className="mx-auto mb-4 items-center justify-center rounded-2xl shadow-md h-16 w-16"
            style={{ backgroundColor: brand?.primaryColor ?? '#01696e', display: brand?.logoUrl ? 'none' : 'flex' }}
          >
            <span className="text-2xl font-bold text-white">S</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{brand?.companyName ?? 'SunanddriveOS'}</h1>
          <p className="mt-1 text-sm text-gray-500">Sun and Drive — La liberté à quatre roues</p>
        </div>

        {/* Formulaire */}
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-6 text-center text-lg font-semibold text-gray-900">Connexion</h2>

          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            {error && (
              <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
            )}

            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-700">
                Adresse email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-[#01696e] focus:ring-2 focus:ring-[#01696e]/20"
                placeholder="vous@example.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-1 block text-sm font-medium text-gray-700">
                Mot de passe
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-10 text-sm outline-none transition focus:border-[#01696e] focus:ring-2 focus:ring-[#01696e]/20"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full rounded-lg py-2.5 text-sm font-semibold text-white transition disabled:opacity-60"
              style={{ backgroundColor: '#01696e' }}
            >
              {isLoading ? 'Connexion...' : 'Se connecter'}
            </button>
          </form>

          <div className="mt-4 text-center">
            <Link to="/forgot-password" className="text-sm text-[#01696e] hover:underline">
              Mot de passe oublié ?
            </Link>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-gray-400">
          © {new Date().getFullYear()} Sun and Drive
        </p>
      </div>
    </div>
  );
}
