import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { api } from '../../utils/api';

interface Vehicle { id: string; make: string; model: string; licensePlate: string; }
interface VehicleRating { id: string; vehicleId: string; period: string; rating: number; reviewCount: number; keywords: string[]; notes: string | null; }
interface QualityAlert { vehicleId: string; licensePlate: string; make: string; model: string; type: string; message: string; rating?: number; previousRating?: number; }

const PRIMARY = '#01696e';

function fmtPeriod(p: string): string {
  const [y, m] = p.split('-');
  const months = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
  return `${months[parseInt(m ?? '1', 10) - 1]} ${y ?? ''}`;
}

function StarInput({ value, onChange }: { value: number; onChange: (v: number) => void }): React.JSX.Element {
  const [hover, setHover] = useState(0);
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(i => (
        <button key={i} type="button"
          onMouseEnter={() => setHover(i)}
          onMouseLeave={() => setHover(0)}
          onClick={() => onChange(i)}
          className="text-2xl leading-none transition-colors"
          style={{ color: i <= (hover || value) ? '#f59e0b' : '#d1d5db' }}>
          ★
        </button>
      ))}
    </div>
  );
}

function Stars({ rating }: { rating: number }): React.JSX.Element {
  return (
    <span className="text-sm text-yellow-500">
      {'★'.repeat(Math.round(rating))}{'☆'.repeat(5 - Math.round(rating))}
    </span>
  );
}

export default function RatingPage(): React.JSX.Element {
  const qc = useQueryClient();

  const now = new Date();
  const [selectedVehicle, setSelectedVehicle] = useState('');
  const [period, setPeriod] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [rating, setRating] = useState(0);
  const [reviewCount, setReviewCount] = useState('');
  const [keywords, setKeywords] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState('');

  const { data: vehiclesData } = useQuery<{ vehicles: Vehicle[] }>({
    queryKey: ['vehicles-active'],
    queryFn: () => api.get<{ vehicles: Vehicle[] }>('/vehicles?isActive=true').then(r => r.data),
    staleTime: 10 * 60_000,
  });
  const vehicles = vehiclesData?.vehicles ?? [];

  const { data: alertsData } = useQuery<{ alerts: QualityAlert[] }>({
    queryKey: ['quality-alerts'],
    queryFn: () => api.get<{ alerts: QualityAlert[] }>('/intelligence/quality-alerts').then(r => r.data),
    staleTime: 10 * 60_000,
  });
  const alerts = alertsData?.alerts ?? [];

  const { data: ratingsData } = useQuery<{ ratings: VehicleRating[] }>({
    queryKey: ['vehicle-ratings', selectedVehicle],
    queryFn: () => api.get<{ ratings: VehicleRating[] }>(`/vehicles/${selectedVehicle}/ratings`).then(r => r.data),
    enabled: !!selectedVehicle,
    staleTime: 5 * 60_000,
  });
  const rawRatings = ratingsData?.ratings ?? [];
  type RatingSortKey = 'period' | 'rating' | 'reviewCount';
  const [ratingSortKey, setRatingSortKey] = useState<RatingSortKey>('period');
  const [ratingSortDir, setRatingSortDir] = useState<'asc' | 'desc'>('desc');

  function toggleRatingSort(k: RatingSortKey) {
    if (ratingSortKey === k) setRatingSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setRatingSortKey(k); setRatingSortDir('desc'); }
  }

  const ratings = [...rawRatings].sort((a, b) => {
    let cmp = 0;
    if (ratingSortKey === 'period') cmp = a.period.localeCompare(b.period);
    else if (ratingSortKey === 'rating') cmp = a.rating - b.rating;
    else if (ratingSortKey === 'reviewCount') cmp = (a.reviewCount ?? 0) - (b.reviewCount ?? 0);
    return ratingSortDir === 'desc' ? -cmp : cmp;
  });

  const saveMut = useMutation({
    mutationFn: () => api.put(`/vehicles/${selectedVehicle}/ratings/${period}`, {
      rating,
      reviewCount: reviewCount ? parseInt(reviewCount) : 0,
      keywords: keywords.split(',').map(k => k.trim()).filter(Boolean),
      notes: notes || undefined,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['vehicle-ratings', selectedVehicle] });
      void qc.invalidateQueries({ queryKey: ['quality-alerts'] });
      setRating(0);
      setReviewCount('');
      setKeywords('');
      setNotes('');
      setFormError('');
    },
  });

  const deleteMut = useMutation({
    mutationFn: (p: string) => api.delete(`/vehicles/${selectedVehicle}/ratings/${p}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['vehicle-ratings', selectedVehicle] }),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedVehicle) { setFormError('Sélectionnez un véhicule'); return; }
    if (!rating) { setFormError('Entrez une note'); return; }
    setFormError('');
    saveMut.mutate();
  }

  // Chart data sorted by period asc
  const chartData = [...ratings]
    .sort((a, b) => a.period.localeCompare(b.period))
    .map(r => ({ period: fmtPeriod(r.period), rating: r.rating }));

  const selectedVehicleObj = vehicles.find(v => v.id === selectedVehicle);

  // Correlation texte : compare avg rating vs les données de performance
  const avgRatingAll = ratings.length > 0
    ? Math.round((ratings.reduce((s, r) => s + r.rating, 0) / ratings.length) * 10) / 10
    : null;

  return (
    <div className="p-4 lg:p-6 max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Notes Getaround</h1>
        <p className="text-sm text-gray-500">Saisie mensuelle et suivi de l'évolution</p>
      </div>

      {/* Alertes qualité */}
      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((a, i) => (
            <div key={i} className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${a.type === 'rating_decline' ? 'border-red-200 bg-red-50' : 'border-orange-200 bg-orange-50'}`}>
              <span className="mt-0.5 text-base">{a.type === 'rating_decline' ? '📉' : '⚠️'}</span>
              <div>
                <p className={`text-sm font-semibold ${a.type === 'rating_decline' ? 'text-red-700' : 'text-orange-700'}`}>
                  {a.licensePlate} — {a.make} {a.model}
                </p>
                <p className={`text-xs mt-0.5 ${a.type === 'rating_decline' ? 'text-red-600' : 'text-orange-600'}`}>{a.message}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Formulaire saisie */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
          <h2 className="text-sm font-semibold text-gray-900">Saisir / mettre à jour une note</h2>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Véhicule *</label>
              <select value={selectedVehicle} onChange={e => setSelectedVehicle(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]">
                <option value="">Sélectionner…</option>
                {vehicles.map(v => (
                  <option key={v.id} value={v.id}>{v.licensePlate} — {v.make} {v.model}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Mois *</label>
              <input type="month" value={period} onChange={e => setPeriod(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Note Getaround *</label>
              <div data-testid="input-note-getaround">
                <StarInput value={rating} onChange={setRating} />
              </div>
              {rating > 0 && <p className="mt-0.5 text-xs text-gray-500">{rating}/5</p>}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Nombre d'avis</label>
              <input type="number" min="0" value={reviewCount} onChange={e => setReviewCount(e.target.value)}
                data-testid="input-nb-avis"
                placeholder="ex: 12"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Mots-clés (séparés par virgule)</label>
              <input value={keywords} onChange={e => setKeywords(e.target.value)}
                placeholder="propre, ponctuel, souriant…"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Notes internes</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                placeholder="Observations, commentaires…"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e] resize-none" />
            </div>
            {formError && <p className="text-xs text-red-600">{formError}</p>}
            {saveMut.isError && <p className="text-xs text-red-600">Erreur lors de la sauvegarde</p>}
            <button type="submit" disabled={saveMut.isPending}
              data-testid="btn-sauvegarder-note"
              className="w-full rounded-xl py-2 text-sm font-semibold text-white disabled:opacity-60 transition"
              style={{ backgroundColor: PRIMARY }}>
              {saveMut.isPending ? 'Sauvegarde…' : 'Enregistrer la note'}
            </button>
          </form>
        </div>

        {/* Graphique historique */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">
              {selectedVehicleObj ? `${selectedVehicleObj.licensePlate} — ${selectedVehicleObj.make} ${selectedVehicleObj.model}` : 'Évolution de la note'}
            </h2>
            {avgRatingAll !== null && (
              <span className="text-xs font-semibold" style={{ color: PRIMARY }}>Moy. {avgRatingAll}/5</span>
            )}
          </div>
          {!selectedVehicle ? (
            <p className="py-12 text-center text-sm text-gray-400">Sélectionnez un véhicule pour voir l'historique</p>
          ) : chartData.length === 0 ? (
            <p className="py-12 text-center text-sm text-gray-400">Aucune note enregistrée pour ce véhicule</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                  <YAxis domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} tick={{ fontSize: 10 }} />
                  <ReferenceLine y={4} stroke="#f59e0b" strokeDasharray="4 4" />
                  <Tooltip formatter={(v: number) => [`${v}/5`, 'Note']} />
                  <Line type="monotone" dataKey="rating" stroke={PRIMARY} strokeWidth={2} dot={{ r: 4, fill: PRIMARY }} />
                </LineChart>
              </ResponsiveContainer>
              {avgRatingAll !== null && (
                <p className="text-xs text-gray-500">
                  {avgRatingAll >= 4.5
                    ? `Note excellente (${avgRatingAll}/5) — corrélation positive avec le taux d'occupation attendue.`
                    : avgRatingAll >= 4.0
                    ? `Note correcte (${avgRatingAll}/5) — améliorer la propreté et ponctualité peut booster le taux d'occupation.`
                    : `Note à améliorer (${avgRatingAll}/5) — les notes basses impactent la visibilité sur Getaround.`}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Historique tableau */}
      {selectedVehicle && ratings.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="border-b border-gray-100 px-5 py-3">
            <h2 className="text-sm font-semibold text-gray-900">Historique des notes</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                {(['period', 'rating', 'reviewCount'] as RatingSortKey[]).map((k, i) => (
                  <th key={k} className={`${i === 0 ? 'px-5' : 'px-4'} py-2 ${i === 0 ? 'text-left' : 'text-center'} cursor-pointer select-none hover:text-gray-700 ${ratingSortKey === k ? 'text-[#01696e]' : ''}`}
                    onClick={() => toggleRatingSort(k)}>
                    {k === 'period' ? 'Période' : k === 'rating' ? 'Note' : 'Avis'}
                    {ratingSortKey === k ? (ratingSortDir === 'desc' ? ' ↓' : ' ↑') : ' ↕'}
                  </th>
                ))}
                <th className="px-4 py-2 text-left">Mots-clés</th>
                <th className="px-4 py-2 text-left">Notes</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {ratings.map(r => (
                <tr key={r.id} className="hover:bg-gray-50/50">
                  <td className="px-5 py-2.5 font-medium text-gray-700">{fmtPeriod(r.period)}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className="font-bold text-gray-900">{r.rating}/5</span>
                    <span className="ml-1 text-yellow-400">{'★'.repeat(Math.round(r.rating))}</span>
                  </td>
                  <td className="px-4 py-2.5 text-center text-gray-500">{r.reviewCount || '—'}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {r.keywords.map((k, i) => (
                        <span key={i} className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600">{k}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-400 max-w-xs truncate">{r.notes ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button type="button" onClick={() => deleteMut.mutate(r.period)} disabled={deleteMut.isPending}
                      className="text-gray-300 hover:text-red-500 transition text-xs">✕</button>
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
