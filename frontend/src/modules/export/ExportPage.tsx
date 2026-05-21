import React, { useState } from 'react';
import { api } from '../../utils/api';

interface ExportConfig {
  type: 'rentals' | 'accounting' | 'vehicles' | 'maintenance';
  label: string;
  description: string;
  endpoint: string;
  hasDateRange: boolean;
  hasStatus: boolean;
  icon: string;
}

const EXPORTS: ExportConfig[] = [
  {
    type: 'rentals',
    label: 'Locations',
    description: 'Toutes les locations sur une période : km, revenus, statuts',
    endpoint: '/exports/rentals',
    hasDateRange: true,
    hasStatus: true,
    icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  },
  {
    type: 'accounting',
    label: 'Comptabilité',
    description: 'CA brut, commissions Getaround, virements propriétaire par mois',
    endpoint: '/exports/accounting',
    hasDateRange: true,
    hasStatus: false,
    icon: 'M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 11h.01M12 11h.01M15 11h.01M4 19h16a2 2 0 002-2V7a2 2 0 00-2-2H4a2 2 0 00-2 2v10a2 2 0 002 2z',
  },
  {
    type: 'vehicles',
    label: 'Flotte',
    description: 'Liste de tous les véhicules actifs avec CT et dernier entretien',
    endpoint: '/exports/vehicles',
    hasDateRange: false,
    hasStatus: false,
    icon: 'M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0zM13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1',
  },
  {
    type: 'maintenance',
    label: 'Entretiens',
    description: 'Historique des entretiens avec coûts et prestataires',
    endpoint: '/exports/maintenance',
    hasDateRange: true,
    hasStatus: false,
    icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z',
  },
];

const thisYear = new Date().getFullYear();
const thisMonth = String(new Date().getMonth() + 1).padStart(2, '0');
const DEFAULT_FROM = `${thisYear}-${thisMonth}-01`;
const DEFAULT_TO = new Date().toISOString().split('T')[0] ?? '';

export default function ExportPage(): React.JSX.Element {
  const [from, setFrom] = useState(DEFAULT_FROM);
  const [to, setTo] = useState(DEFAULT_TO);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleExport(config: ExportConfig): Promise<void> {
    setLoading(config.type);
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (config.hasDateRange) { params.from = from; params.to = to; }
      if (config.hasStatus && status) params.status = status;

      const response = await api.get(config.endpoint, {
        params,
        responseType: 'blob',
      });

      const disposition = (response.headers as Record<string, string>)['content-disposition'] ?? '';
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match?.[1] ?? `${config.type}.csv`;

      const url = URL.createObjectURL(response.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('Erreur lors de l\'export');
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="p-4 lg:p-6 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Exports</h1>
        <p className="text-sm text-gray-500">Téléchargez vos données au format CSV (compatible Excel)</p>
      </div>

      {/* Filtres globaux */}
      <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Paramètres</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Date de début</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Date de fin</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Statut (locations)</label>
            <select value={status} onChange={e => setStatus(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]">
              <option value="">Tous les statuts</option>
              <option value="booked">Réservées</option>
              <option value="active">En cours</option>
              <option value="completed">Terminées</option>
              <option value="cancelled">Annulées</option>
            </select>
          </div>
        </div>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </div>

      {/* Cartes d'export */}
      <div className="grid gap-3 sm:grid-cols-2">
        {EXPORTS.map(config => (
          <button key={config.type} type="button"
            onClick={() => void handleExport(config)}
            disabled={loading === config.type}
            className="flex items-start gap-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm text-left transition hover:border-[#01696e]/40 hover:shadow-md disabled:opacity-60 group">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl group-hover:opacity-90"
              style={{ backgroundColor: '#01696e' }}>
              {loading === config.type ? (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-t-transparent border-white" />
              ) : (
                <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={config.icon} />
                </svg>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-gray-900">{config.label}</p>
                <svg className="h-4 w-4 text-gray-300 group-hover:text-[#01696e] transition" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              </div>
              <p className="mt-0.5 text-xs text-gray-500 leading-snug">{config.description}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {config.hasDateRange && (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500">Plage de dates</span>
                )}
                {config.hasStatus && (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500">Filtre statut</span>
                )}
                <span className="rounded-full bg-green-50 px-2 py-0.5 text-[10px] text-green-600">CSV</span>
              </div>
            </div>
          </button>
        ))}
      </div>

      <p className="mt-6 text-xs text-gray-400">
        Les fichiers CSV sont encodés en UTF-8 avec BOM pour une compatibilité optimale avec Microsoft Excel.
      </p>
    </div>
  );
}
