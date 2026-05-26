import React, { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, isPast, differenceInDays } from 'date-fns';
import { fr } from 'date-fns/locale';
import { api } from '../../utils/api';

interface VehicleDoc {
  id: string;
  type: string;
  name: string;
  fileUrl: string;
  expiryDate: string | null;
  vehicle: { id: string; make: string; model: string; licensePlate: string };
}

const TYPE_LABELS: Record<string, string> = {
  insurance: 'Assurance', registration: 'Carte grise', lease: 'Bail/Contrat',
  technical_control: 'Contrôle technique', other: 'Autre',
};

const EMPTY_FORM = { vehicleId: '', type: 'insurance', name: '', expiryDate: '' };

export default function DocumentsPage(): React.JSX.Element {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const { data: docs = [], isLoading } = useQuery({
    queryKey: ['documents'],
    queryFn: () => api.get<{ documents: VehicleDoc[] }>('/documents').then(r => r.data.documents),
    staleTime: 2 * 60_000,
  });

  const { data: vehiclesData } = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => api.get<{ vehicles: { id: string; make: string; model: string; licensePlate: string }[] }>('/vehicles').then(r => r.data.vehicles),
    staleTime: 5 * 60_000,
  });

  const uploadMutation = useMutation({
    mutationFn: (fd: FormData) => api.post('/documents', fd, { headers: { 'Content-Type': 'multipart/form-data' } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['documents'] }); setShowForm(false); setForm(EMPTY_FORM); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/documents/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['documents'] }),
  });

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('vehicleId', form.vehicleId);
    fd.append('type', form.type);
    fd.append('name', form.name);
    if (form.expiryDate) fd.append('expiryDate', new Date(form.expiryDate).toISOString());
    fd.append('file', file);
    uploadMutation.mutate(fd);
  }

  function expiryBadge(date: string | null): React.ReactNode {
    if (!date) return null;
    const d = new Date(date);
    const days = differenceInDays(d, new Date());
    if (isPast(d)) return <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">Expiré</span>;
    if (days <= 30) return <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">Expire dans {days} j</span>;
    return <span className="text-xs text-gray-400">{format(d, 'dd/MM/yyyy', { locale: fr })}</span>;
  }

  return (
    <div className="p-4 lg:p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Documents</h1>
          <p className="text-sm text-gray-500">{docs.length} document{docs.length !== 1 ? 's' : ''}</p>
        </div>
        <button type="button" onClick={() => setShowForm(true)}
          className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white" style={{ backgroundColor: '#01696e' }}>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Ajouter
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="mb-6 rounded-2xl border border-[#01696e]/20 bg-[#01696e]/5 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-900">Nouveau document</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Véhicule *</label>
              <select required value={form.vehicleId} onChange={e => setForm(f => ({ ...f, vehicleId: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]">
                <option value="">Sélectionner...</option>
                {vehiclesData?.map(v => <option key={v.id} value={v.id}>{v.make} {v.model} — {v.licensePlate}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Type *</label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]">
                {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Nom du document *</label>
              <input required type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" placeholder="Assurance 2025" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Date d'expiration</label>
              <input type="date" value={form.expiryDate} onChange={e => setForm(f => ({ ...f, expiryDate: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-gray-600">Fichier * (PDF, JPG, PNG)</label>
              <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" required
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={uploadMutation.isPending}
              className="rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" style={{ backgroundColor: '#01696e' }}>
              {uploadMutation.isPending ? 'Upload...' : 'Enregistrer'}
            </button>
            <button type="button" onClick={() => setShowForm(false)}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Annuler</button>
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16"><div className="h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" style={{ borderColor: '#01696e', borderTopColor: 'transparent' }} /></div>
      ) : docs.length === 0 ? (
        <div className="py-16 text-center"><p className="text-gray-400">Aucun document enregistré</p></div>
      ) : (
        <div className="space-y-2">
          {docs.map(d => (
            <div key={d.id} className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100">
                <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-gray-900">{d.name}</span>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">{TYPE_LABELS[d.type] ?? d.type}</span>
                  {expiryBadge(d.expiryDate)}
                </div>
                <p className="text-xs text-gray-400">{d.vehicle.make} {d.vehicle.model} · <span className="font-mono">{d.vehicle.licensePlate}</span></p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <a href={d.fileUrl} target="_blank" rel="noopener noreferrer"
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">Voir</a>
                <button type="button" onClick={() => { if (confirm('Supprimer ce document ?')) deleteMutation.mutate(d.id); }}
                  className="p-1 text-gray-300 hover:text-red-500">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
