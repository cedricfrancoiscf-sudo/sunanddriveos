import type React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

export default function BlockedPage(): React.JSX.Element {
  const { logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout(): void {
    logout();
    navigate('/login');
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
      <div className="text-center max-w-md">
        <div
          className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl mx-auto"
          style={{ backgroundColor: '#01696e' }}
        >
          <span className="text-2xl font-bold text-white">S</span>
        </div>
        <div className="mb-4 text-5xl">🔒</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-3">Votre accès est suspendu</h1>
        <p className="text-gray-500 mb-8">Contactez Sun and Drive pour réactiver votre compte.</p>
        <a
          href="mailto:contact@sunanddrive.com"
          className="inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-white mb-4"
          style={{ backgroundColor: '#01696e' }}
        >
          Contacter Sun and Drive
        </a>
        <div>
          <button
            type="button"
            onClick={handleLogout}
            className="text-sm text-gray-400 hover:text-gray-600 underline"
          >
            Se déconnecter
          </button>
        </div>
      </div>
    </div>
  );
}
