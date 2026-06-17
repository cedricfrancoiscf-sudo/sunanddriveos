import React, { useState } from 'react';
import { api } from '../../utils/api';

type Tab = 'fec' | 'csv' | 'other';

interface DownloadEntry { label: string; filename: string; at: string; }

const thisYear = new Date().getFullYear();
const thisMonth = String(new Date().getMonth() + 1).padStart(2, '0');
const DEFAULT_START = `${thisYear}-${thisMonth}-01`;
const DEFAULT_END = new Date().toISOString().split('T')[0] ?? '';

async function triggerDownload(url: string, params: Record<string, string>): Promise<string> {
  const response = await api.get(url, { params, responseType: 'blob' });
  const disposition = (response.headers as Record<string, string>)['content-disposition'] ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename = match?.[1] ?? 'export';
  const blobUrl = URL.createObjectURL(response.data as Blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(blobUrl);
  return filename;
}

export default function ExportPage(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('fec');
  const [startDate, setStartDate] = useState(DEFAULT_START);
  const [endDate, setEndDate] = useState(DEFAULT_END);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<DownloadEntry[]>([]);

  async function download(endpoint: string, params: Record<string, string> = {}): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const filename = await triggerDownload(endpoint, params);
      setHistory(h => [{ label: endpoint.split('/').pop() ?? endpoint, filename, at: new Date().toLocaleTimeString('fr-FR') }, ...h.slice(0, 9)]);
    } catch {
      setError('Erreur lors du téléchargement');
    } finally {
      setLoading(false);
    }
  }

  const dateParams = { startDate, endDate };

  const TABS: { key: Tab; label: string }[] = [
    { key: 'fec', label: 'FEC DGFiP' },
    { key: 'csv', label: 'CSV brut' },
    { key: 'other', label: 'Autres exports' },
  ];

  return (
    <div className="p-4 lg:p-6 max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Exports</h1>
        <p className="text-sm text-gray-500">Téléchargez vos données comptables et opérationnelles</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-gray-100 p-1 w-fit" data-testid="export-tabs">
        {TABS.map(t => (
          <button key={t.key} type="button"
            onClick={() => setTab(t.key)}
            data-testid={`tab-export-${t.key}`}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Period selector */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Période</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Date de début</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
              data-testid="input-export-start"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Date de fin</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
              data-testid="input-export-end"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
          </div>
          {tab === 'other' && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Statut (locations)</label>
              <select value={status} onChange={e => setStatus(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]">
                <option value="">Tous</option>
                <option value="booked">Réservées</option>
                <option value="active">En cours</option>
                <option value="completed">Terminées</option>
                <option value="cancelled">Annulées</option>
              </select>
            </div>
          )}
        </div>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </div>

      {/* FEC tab */}
      {tab === 'fec' && (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Export FEC — DGFiP</h2>
            <p className="mt-0.5 text-xs text-gray-400">Format légal Fichier des Écritures Comptables conforme DGFiP — pipe-séparé, dates YYYYMMDD, montants virgule</p>
          </div>
          <ul className="text-xs text-gray-500 space-y-0.5 list-disc list-inside">
            <li>Écritures de produits (virements Getaround)</li>
            <li>Écritures de charges (coûts véhicules)</li>
            <li>Numéros de compte configurables dans les Paramètres → Comptabilité</li>
          </ul>
          <button type="button" disabled={loading}
            onClick={() => void download('/exports/fec', dateParams)}
            data-testid="btn-export-fec"
            className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            style={{ backgroundColor: '#01696e' }}>
            {loading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-t-transparent border-white" /> : null}
            Télécharger le FEC (.txt)
          </button>
          <p className="text-[11px] text-gray-400">Encodage UTF-8 · séparateur | · 18 colonnes DGFiP obligatoires</p>
        </div>
      )}

      {/* CSV tab */}
      {tab === 'csv' && (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Export CSV brut — Locations</h2>
            <p className="mt-0.5 text-xs text-gray-400">Tableau mensuel des locations compatible Excel FR (BOM UTF-8, point-virgule)</p>
          </div>
          <ul className="text-xs text-gray-500 space-y-0.5 list-disc list-inside">
            <li>Date, locataire, véhicule, immatriculation</li>
            <li>CA brut, CA net (virement), statut en français, ID Getaround</li>
            <li>Montants avec virgule décimale (format FR)</li>
          </ul>
          <button type="button" disabled={loading}
            onClick={() => void download('/exports/csv', dateParams)}
            data-testid="btn-export-csv"
            className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            style={{ backgroundColor: '#01696e' }}>
            {loading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-t-transparent border-white" /> : null}
            Télécharger le CSV (.csv)
          </button>
          <p className="text-[11px] text-gray-400">Encodage UTF-8 BOM · séparateur ; · compatible Excel FR</p>
        </div>
      )}

      {/* Other exports tab */}
      {tab === 'other' && (
        <div className="grid gap-3 sm:grid-cols-2">
          {([
            { key: 'rentals', label: 'Locations détaillées', desc: 'Km, revenus, statuts, notes conducteur', endpoint: '/exports/rentals', hasStatus: true },
            { key: 'accounting', label: 'Comptabilité', desc: 'CA brut, commissions, virements par mois', endpoint: '/exports/accounting', hasStatus: false },
            { key: 'vehicles', label: 'Flotte', desc: 'Véhicules actifs avec CT et dernier entretien', endpoint: '/exports/vehicles', hasStatus: false },
            { key: 'maintenance', label: 'Entretiens', desc: 'Historique entretiens avec coûts et prestataires', endpoint: '/exports/maintenance', hasStatus: false },
          ] as const).map(cfg => (
            <button key={cfg.key} type="button"
              disabled={loading}
              onClick={() => void download(cfg.endpoint, { from: startDate, to: endDate, ...(cfg.hasStatus && status ? { status } : {}) })}
              className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm text-left transition hover:border-[#01696e]/40 disabled:opacity-60">
              <div>
                <p className="font-medium text-sm text-gray-900">{cfg.label}</p>
                <p className="mt-0.5 text-xs text-gray-500">{cfg.desc}</p>
                <span className="mt-1.5 inline-block rounded-full bg-green-50 px-2 py-0.5 text-[10px] text-green-600">CSV</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Download history */}
      {history.length > 0 && (
        <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Historique de session</h2>
          {history.map((h, i) => (
            <div key={i} className="flex items-center justify-between text-xs text-gray-600">
              <span className="font-mono truncate max-w-[220px]">{h.filename}</span>
              <span className="text-gray-400 shrink-0 ml-2">{h.at}</span>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-gray-400">
        Les numéros de compte FEC sont configurables dans Paramètres → Comptabilité.
      </p>
    </div>
  );
}
