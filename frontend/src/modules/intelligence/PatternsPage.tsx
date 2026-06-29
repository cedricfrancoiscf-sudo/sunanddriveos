import React, { useEffect } from 'react';
import { trackEvent } from '../../utils/tracking';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts';
import { api } from '../../utils/api';

interface ParJour { day: string; count: number; ca: number }
interface ParTranche { heure: string; count: number }
interface DureeMoyParJour { day: string; dureeMoy: number }
interface Insight { label: string; value: string; icon: string }
interface PatternsData {
  parJour: ParJour[];
  parTranche: ParTranche[];
  dureeMoyParJour: DureeMoyParJour[];
  insights: Insight[];
}

const DAY_COLORS = ['#8b5cf6', '#01696e', '#01696e', '#01696e', '#01696e', '#01696e', '#8b5cf6'];
const MAX_HEATMAP_COLOR = '#01696e';

function heatmapColor(count: number, max: number): string {
  if (max === 0 || count === 0) return '#f3f4f6';
  const intensity = count / max;
  const r = Math.round(1 + (1 - intensity) * (243 - 1));
  const g = Math.round(105 + (1 - intensity) * (244 - 105));
  const b = Math.round(110 + (1 - intensity) * (246 - 110));
  return `rgb(${r},${g},${b})`;
}
void MAX_HEATMAP_COLOR;

export default function PatternsPage(): React.JSX.Element {
  const navigate = useNavigate();
  useEffect(() => { void trackEvent('intelligence', 'patterns'); }, []);

  const { data, isLoading } = useQuery<PatternsData>({
    queryKey: ['intelligence-patterns'],
    queryFn: () => api.get<PatternsData>('/intelligence/patterns').then(r => r.data),
    staleTime: 30 * 60_000,
  });

  const maxTranche = data ? Math.max(...data.parTranche.map(t => t.count), 1) : 1;
  const TRANCHE_ROWS = data ? [
    { label: 'Nuit (0h–6h)', indices: [0,1,2,3,4,5] },
    { label: 'Matin (6h–12h)', indices: [6,7,8,9,10,11] },
    { label: 'Après-midi (12h–18h)', indices: [12,13,14,15,16,17] },
    { label: 'Soir (18h–24h)', indices: [18,19,20,21,22,23] },
  ] : [];

  return (
    <div className="p-4 lg:p-6 space-y-6">
      {/* En-tête */}
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => navigate('/intelligence')}
          className="text-sm text-gray-400 hover:text-gray-600">← Retour</button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Patterns &amp; Heatmap</h1>
          <p className="text-sm text-gray-500">Analyse comportementale des 12 derniers mois</p>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1,2,3,4].map(i => <div key={i} className="h-24 rounded-2xl bg-gray-100 animate-pulse" />)}
        </div>
      ) : data ? (
        <>
          {/* Insights KPI */}
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            {data.insights.map(ins => (
              <div key={ins.label} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{ins.icon}</span>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{ins.label}</p>
                </div>
                <p className="mt-2 text-lg font-bold text-gray-900">{ins.value}</p>
              </div>
            ))}
          </div>

          {/* Départs par jour de la semaine */}
          <div>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Départs par jour de la semaine</h2>
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={data.parJour} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid stroke="#e5e7eb" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v: number, name: string) => [v, name === 'count' ? 'départs' : 'CA €']} />
                  <Bar dataKey="count" name="count" radius={[3, 3, 0, 0]}>
                    {data.parJour.map((_, i) => (
                      <Cell key={i} fill={DAY_COLORS[i] ?? '#01696e'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Heatmap tranches horaires */}
          <div>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Heatmap tranches horaires</h2>
            <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
              {TRANCHE_ROWS.map(row => (
                <div key={row.label}>
                  <p className="mb-1.5 text-[10px] font-semibold text-gray-400">{row.label}</p>
                  <div className="flex gap-1.5">
                    {row.indices.map(idx => {
                      const t = data.parTranche[idx];
                      return (
                        <div key={idx} className="flex-1 flex flex-col items-center gap-1">
                          <div
                            className="w-full rounded-md"
                            style={{ height: '32px', backgroundColor: heatmapColor(t?.count ?? 0, maxTranche) }}
                            title={`${t?.heure ?? ''} : ${t?.count ?? 0} départs`}
                          />
                          <span className="text-[9px] text-gray-400">{t?.heure ?? ''}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              <div className="flex items-center gap-2 pt-1">
                <span className="text-[9px] text-gray-400">Faible</span>
                <div className="flex gap-0.5 flex-1">
                  {[0, 0.2, 0.4, 0.6, 0.8, 1].map(v => (
                    <div key={v} className="flex-1 h-2 rounded-sm" style={{ backgroundColor: heatmapColor(Math.round(v * maxTranche), maxTranche) }} />
                  ))}
                </div>
                <span className="text-[9px] text-gray-400">Élevé</span>
              </div>
            </div>
          </div>

          {/* Durée moyenne par jour */}
          <div>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Durée moyenne de location par jour de départ</h2>
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={data.dureeMoyParJour} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid stroke="#e5e7eb" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${v}j`} />
                  <Tooltip formatter={(v: number) => [`${v}j`, 'durée moy.']} />
                  <Bar dataKey="dureeMoy" name="dureeMoy" radius={[3, 3, 0, 0]}>
                    {data.dureeMoyParJour.map((_, i) => (
                      <Cell key={i} fill={DAY_COLORS[i] ?? '#01696e'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-400">
          Aucune donnée disponible
        </div>
      )}
    </div>
  );
}
