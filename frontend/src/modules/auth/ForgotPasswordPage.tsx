import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../utils/api';

export default function ForgotPasswordPage(): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [companySlug, setCompanySlug] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post('/auth/forgot-password', { email, companySlug });
      setSent(true);
    } catch {
      setError('Une erreur est survenue. Vérifiez vos informations et réessayez.');
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
          <h1 className="text-2xl font-bold text-gray-900">Mot de passe oublié</h1>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          {sent ? (
            <div className="text-center space-y-4">
              <div className="text-4xl">📧</div>
              <p className="text-sm text-gray-700">
                Si cet email existe dans notre système, un lien de réinitialisation vous a été envoyé.
              </p>
              <p className="text-xs text-gray-400">Vérifiez vos spams si nécessaire. Le lien est valable 24 heures.</p>
            </div>
          ) : (
            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
              <p className="text-sm text-gray-500">
                Entrez votre email et l'identifiant de votre société pour recevoir un lien de réinitialisation.
              </p>

              {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Adresse email</label>
                <input required type="email" value={email} onChange={e => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#01696e] focus:ring-2 focus:ring-[#01696e]/20"
                  placeholder="vous@example.com" />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Identifiant société (slug)</label>
                <input required type="text" value={companySlug} onChange={e => setCompanySlug(e.target.value.toLowerCase())}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono outline-none focus:border-[#01696e] focus:ring-2 focus:ring-[#01696e]/20"
                  placeholder="sun-and-drive" />
              </div>

              <button type="submit" disabled={loading}
                className="w-full rounded-lg py-2.5 text-sm font-semibold text-white transition disabled:opacity-60"
                style={{ backgroundColor: '#01696e' }}>
                {loading ? 'Envoi...' : 'Envoyer le lien'}
              </button>
            </form>
          )}
        </div>

        <div className="mt-4 text-center">
          <Link to="/login" className="text-sm text-gray-500 hover:text-gray-700">
            ← Retour à la connexion
          </Link>
        </div>
      </div>
    </div>
  );
}
