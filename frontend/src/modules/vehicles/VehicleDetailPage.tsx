import React, { useState, useRef, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ComposedChart, CartesianGrid, ReferenceArea, ReferenceLine, Legend } from 'recharts';
import { QRCodeCanvas } from 'qrcode.react';
import { vehiclesApi, vehicleCarkeepersApi, vehiclePhotosApi, vehicleRatingsApi, type VehiclePhoto, type VehicleRating } from './vehiclesApi';
import { blockingsApi, BLOCKING_TYPE_LABELS, BLOCKING_TYPE_COLORS } from './blockingsApi';
import { useAuth } from '../../hooks/useAuth';
import { api } from '../../utils/api';
import { DocumentScanner } from '../../components/ui/DocumentScanner';

interface VehicleCost {
  id: string;
  label: string;
  amount: number;
  type: string;
  createdAt: string;
}

interface VehicleValuation {
  id: string;
  estimatedValue: number;
  source: string;
  evaluatedAt: string;
}

interface VehicleWarranty {
  id: string;
  warrantyStartDate: string | null;
  warrantyMonths: number | null;
  warrantyExtension: boolean;
  warrantyExtensionEnd: string | null;
  warrantyTires: boolean;
  warrantyTiresEnd: string | null;
  notes: string | null;
}

const CRITAIR_LABELS: Record<string, { label: string; color: string }> = {
  '0': { label: 'Crit\'Air 0 — Électrique/hydrogène', color: 'bg-violet-100 text-violet-700' },
  '1': { label: 'Crit\'Air 1 — Essence récente / hybride', color: 'bg-purple-100 text-purple-700' },
  '2': { label: 'Crit\'Air 2 — Essence 2011+ / diesel 2011+', color: 'bg-yellow-100 text-yellow-700' },
  '3': { label: 'Crit\'Air 3 — Essence 2006–2010', color: 'bg-orange-100 text-orange-700' },
  '4': { label: 'Crit\'Air 4 — Diesel 2001–2006', color: 'bg-pink-100 text-pink-700' },
  '5': { label: 'Crit\'Air 5 — Diesel avant 2001', color: 'bg-red-100 text-red-700' },
  'NC': { label: 'Non classé', color: 'bg-gray-100 text-gray-600' },
};

const RATING_KEYWORDS = ['Propreté', 'Ponctualité', 'Communication', 'État du véhicule'] as const;

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-400">{title}</h2>
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-900">{value ?? '—'}</span>
    </div>
  );
}

const RESULT_LABELS: Record<string, string> = {
  favorable: 'Favorable',
  defavorable: 'Défavorable',
  contre_visite: 'Contre-visite',
};

const RESULT_COLORS: Record<string, string> = {
  favorable: 'text-green-600',
  defavorable: 'text-red-600',
  contre_visite: 'text-orange-600',
};

const BLOCKING_TYPES = ['maintenance', 'incident', 'administrative', 'other'] as const;

interface BlockingFormData {
  startAt: string;
  endAt: string;
  reason: string;
  type: typeof BLOCKING_TYPES[number];
}

const emptyForm: BlockingFormData = {
  startAt: '',
  endAt: '',
  reason: '',
  type: 'maintenance',
};

// ─── ROI Analysis ─────────────────────────────────────────────────────────────

interface RoiDataPoint {
  mois: number;
  roi: number;
  valeurMarchande: number;
  plusValue: number;
  couts: number;
  capitalRestant: number;
  caCumule: number;
  dateLabel: string;
  estHistorique: boolean;
  estAujourdhui: boolean;
  hasSnapshot: boolean;
  cashflow: number;
  cashflowCumule: number;
  mensualite: number;
  totalSortiDePoche: number;
  cocReturn: number | null;
  tri: number | null;
  caReel: number;
}

interface RoiAnalysis {
  roiActuel: number;
  roiMax: number;
  moisOptimal: number;
  moisRestants: number;
  dateOptimale: string;
  plusValueNette: number;
  capitalRestantDu: number;
  signal: 'vendre_maintenant' | 'bientot' | 'attendre' | 'optimal';
  courbe: RoiDataPoint[];
  caMensuelMoyen: number;
  coutsMensuelsTotaux: number;
  mensualitePret: number;
  loanDeposit: number;
  caMensuelNormalise: number;
  caParMoisCalendaire: number[];
  triActuel: number | null;
  triMax: number | null;
  moisOptimalTri: number;
  cocActuel: number | null;
  cocMax: number | null;
  cashflowMensuelNet: number;
}

const SIGNAL_CONFIG: Record<RoiAnalysis['signal'], { colorClass: string; icon: string; label: string }> = {
  vendre_maintenant: { colorClass: 'bg-red-100 text-red-700 border border-red-200', icon: '🔴', label: 'Revendre maintenant — ROI en déclin' },
  bientot: { colorClass: 'bg-amber-100 text-amber-700 border border-amber-200', icon: '🟡', label: 'Revendre dans les 6 prochains mois' },
  optimal: { colorClass: 'bg-green-100 text-green-700 border border-green-200', icon: '🟢', label: '' },
  attendre: { colorClass: 'bg-gray-100 text-gray-600 border border-gray-200', icon: '⚪', label: 'Continuer à exploiter — ROI croissant' },
};

function fmtMonthYear(iso: string): string {
  return new Date(iso + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

function RoiKpi({ label, value, colorClass }: { label: string; value: React.ReactNode; colorClass?: string }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-base font-bold ${colorClass ?? 'text-gray-900'}`}>{value}</p>
    </div>
  );
}

function RoiAnalysisSection({ vehicleId, vehicle }: {
  vehicleId: string;
  vehicle: { purchasePrice?: number | null; purchaseDate?: string | null; marketValue?: number | null; marketValueDate?: string | null };
}): React.JSX.Element {
  const navigate = useNavigate();
  const hasData = Boolean(vehicle.purchasePrice && vehicle.purchaseDate && vehicle.marketValue);
  const now = new Date();

  const { data: roiResp, isLoading } = useQuery<{ analysis: RoiAnalysis | null }>({
    queryKey: ['roi-analysis', vehicleId],
    queryFn: () => api.get<{ analysis: RoiAnalysis | null }>(`/vehicles/${vehicleId}/roi-analysis`).then(r => r.data),
    enabled: hasData,
    staleTime: 10 * 60_000,
  });

  const mktDateStale = vehicle.marketValueDate
    ? (now.getTime() - new Date(vehicle.marketValueDate).getTime()) > 30 * 24 * 60 * 60 * 1000
    : false;

  return (
    <div data-testid="roi-analysis-section" className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-400">Analyse de revente</h2>

      {!hasData ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-500">
            Saisissez la valeur de revente estimée (source :{' '}
            <span className="text-[#01696e] font-medium">vendezvotrevoiture.fr</span>) pour calculer
            votre fenêtre optimale de vente.
          </p>
          <button type="button" onClick={() => navigate(`/vehicles/${vehicleId}/edit`)}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-white"
            style={{ backgroundColor: '#01696e' }}>
            Saisir la valeur
          </button>
        </div>
      ) : isLoading ? (
        <div className="flex justify-center py-6">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-t-transparent" style={{ borderColor: '#01696e', borderTopColor: 'transparent' }} />
        </div>
      ) : roiResp?.analysis ? (
        <RoiAnalysisDisplay analysis={roiResp.analysis} vehicleId={vehicleId} mktDateStale={mktDateStale} />
      ) : (
        <p className="text-sm text-gray-400 italic">Données insuffisantes pour le calcul.</p>
      )}
    </div>
  );
}

function RoiAnalysisDisplay({ analysis, mktDateStale }: {
  analysis: RoiAnalysis; vehicleId: string; mktDateStale: boolean;
}): React.JSX.Element {
  const cfg = SIGNAL_CONFIG[analysis.signal];
  const signalLabel =
    analysis.signal === 'optimal'
      ? `Moment optimal dans ${analysis.moisRestants} mois (${fmtMonthYear(analysis.dateOptimale)})`
      : analysis.signal === 'bientot'
        ? `Revendre dans ${analysis.moisRestants} mois (${fmtMonthYear(analysis.dateOptimale)})`
        : cfg.label;

  // Indice du mois actuel dans la courbe 48 mois
  const moisActuelIdx = analysis.courbe.findIndex(d => d.estAujourdhui);
  const todayLabel = moisActuelIdx >= 0 ? analysis.courbe[moisActuelIdx]?.dateLabel ?? '' : '';

  // Courbe échantillonnée : toutes les 3 périodes + point optimal + aujourd'hui
  const chartData = analysis.courbe
    .filter((d, i) => i % 3 === 0 || d.mois === analysis.moisOptimal || d.estAujourdhui)
    .map(d => ({ ...d, label: d.dateLabel }));

  // Fenêtre optimale ±3 mois (indices absolus depuis purchaseDate)
  const optStart = Math.max(0, analysis.moisOptimal - 3);
  const optEnd = Math.min(48, analysis.moisOptimal + 3);
  const optLabelStart = analysis.courbe[optStart]?.dateLabel ?? '';
  const optLabelEnd = analysis.courbe[optEnd]?.dateLabel ?? '';

  // Zone historique
  const histoStart = analysis.courbe[0]?.dateLabel ?? '';

  const optimalPoint = analysis.courbe[analysis.moisOptimal];

  return (
    <div className="space-y-4">
      {mktDateStale && (
        <div className="inline-flex items-center gap-1.5 rounded-full bg-orange-100 px-3 py-1 text-xs font-medium text-orange-700">
          ⚠ Mettre à jour la valeur marchande (estimation &gt; 30 jours)
        </div>
      )}

      {/* KPIs — ligne 1 */}
      <div className="grid grid-cols-2 gap-2">
        <RoiKpi label="ROI actuel" value={`${analysis.roiActuel.toFixed(1)}%`}
          colorClass={analysis.roiActuel >= 0 ? 'text-green-700' : 'text-red-600'} />
        <RoiKpi label="ROI optimal" value={`${analysis.roiMax.toFixed(1)}%`} colorClass="text-blue-700" />
        <RoiKpi label="Plus-value nette"
          value={`${analysis.plusValueNette >= 0 ? '+' : ''}${analysis.plusValueNette.toLocaleString('fr-FR')} €`}
          colorClass={analysis.plusValueNette >= 0 ? 'text-green-700' : 'text-red-600'} />
        {analysis.capitalRestantDu > 0 ? (
          <RoiKpi label="Capital restant dû" value={`${analysis.capitalRestantDu.toLocaleString('fr-FR')} €`} colorClass="text-orange-600" />
        ) : (
          <RoiKpi label="CA généré (6 mois)" value={`${(analysis.caMensuelMoyen * 6).toLocaleString('fr-FR')} €`} />
        )}
      </div>

      {/* KPIs — ligne 2 : mensualité, cashflow, CA normalisé */}
      <div className="grid grid-cols-3 gap-2">
        <RoiKpi label="Mensualité prêt"
          value={analysis.mensualitePret > 0 ? `${analysis.mensualitePret.toLocaleString('fr-FR')} €/mois` : '—'} />
        <RoiKpi label="Cashflow net"
          value={`${analysis.cashflowMensuelNet >= 0 ? '+' : ''}${analysis.cashflowMensuelNet.toLocaleString('fr-FR')} €/mois`}
          colorClass={analysis.cashflowMensuelNet >= 0 ? 'text-green-700' : 'text-red-600'} />
        <RoiKpi label="CA normalisé" value={`${analysis.caMensuelNormalise.toLocaleString('fr-FR')} €/mois`} />
      </div>

      {/* KPIs — ligne 3 : TRI, CoC */}
      <div className="grid grid-cols-3 gap-2">
        <RoiKpi label="TRI actuel"
          value={analysis.triActuel !== null ? `${analysis.triActuel.toFixed(1)}%/an` : '—'}
          {...(analysis.triActuel !== null
            ? { colorClass: analysis.triActuel >= 0 ? 'text-green-700' : 'text-red-600' }
            : {})} />
        <RoiKpi label="TRI optimal"
          value={analysis.triMax !== null ? `${analysis.triMax.toFixed(1)}%/an` : '—'}
          colorClass="text-blue-700" />
        <RoiKpi label="Cash-on-Cash"
          value={analysis.cocActuel !== null ? `${analysis.cocActuel.toFixed(1)}%` : '—'}
          {...(analysis.cocActuel !== null
            ? { colorClass: analysis.cocActuel >= 0 ? 'text-green-700' : 'text-red-600' }
            : {})} />
      </div>

      {/* Hint apport personnel pour TRI */}
      {analysis.triActuel === null && (analysis.loanDeposit === 0 || analysis.loanDeposit == null) && (
        <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 border border-amber-100">
          Renseignez votre apport personnel dans la fiche véhicule pour activer le calcul du TRI et du Cash-on-Cash.
        </p>
      )}

      {/* Signal */}
      <div className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold ${cfg.colorClass}`}>
        <span>{cfg.icon}</span>
        <span>{signalLabel}</span>
      </div>

      {/* Graphique 48 mois depuis purchaseDate */}
      <div>
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 38, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="label" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
            <YAxis yAxisId="roi" tick={{ fontSize: 9 }} tickFormatter={v => `${v}%`} width={38} />
            <YAxis yAxisId="euro" orientation="right" tick={{ fontSize: 9 }} tickFormatter={v => `${Math.round(v / 1000)}k`} width={32} />
            <Tooltip
              formatter={(value: number, name: string) =>
                name === 'ROI' || name === 'TRI%' || name === 'CoC%'
                  ? [`${value.toFixed(1)}%`, name]
                  : [`${Math.round(value).toLocaleString('fr-FR')} €`, name]
              }
              labelFormatter={l => `Période : ${l}`}
              contentStyle={{ fontSize: 11 }}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {/* Zone historique (grisée) */}
            {moisActuelIdx > 0 && (
              <ReferenceArea yAxisId="roi" x1={histoStart} x2={todayLabel}
                fill="#6b7280" fillOpacity={0.06} />
            )}
            {/* Fenêtre optimale */}
            {analysis.moisRestants > 0 && (
              <ReferenceArea yAxisId="roi" x1={optLabelStart} x2={optLabelEnd}
                fill="#01696e" fillOpacity={0.10}
                label={{ value: 'Fenêtre optimale', position: 'insideTop', fontSize: 9, fill: '#01696e' }} />
            )}
            {/* Ligne zéro ROI */}
            <ReferenceLine yAxisId="roi" y={0} stroke="#9ca3af" strokeDasharray="2 2" />
            {/* Aujourd'hui */}
            {todayLabel && (
              <ReferenceLine yAxisId="roi" x={todayLabel} stroke="#9ca3af" strokeDasharray="3 3"
                label={{ value: 'Auj.', position: 'insideTopLeft', fontSize: 9, fill: '#6b7280' }} />
            )}
            <Line yAxisId="roi" type="monotone" dataKey="roi" stroke="#3b82f6" strokeWidth={2} dot={false} name="ROI" />
            <Line yAxisId="euro" type="monotone" dataKey="valeurMarchande" stroke="#f97316" strokeWidth={1.5}
              dot={(props: Record<string, unknown>) => {
                const payload = props.payload as RoiDataPoint | undefined;
                if (!payload?.hasSnapshot) return <g key={String(props.key ?? '')} />;
                const cx = Number(props.cx ?? 0);
                const cy = Number(props.cy ?? 0);
                return (
                  <polygon key={String(props.key ?? '')}
                    points={`${cx},${cy - 5} ${cx + 5},${cy} ${cx},${cy + 5} ${cx - 5},${cy}`}
                    fill="#f97316" />
                );
              }}
              name="Valeur marchande" />
            <Line yAxisId="euro" type="monotone" dataKey="plusValue" stroke="#22c55e" strokeWidth={1.5} dot={false} name="Plus-value" />
            {analysis.capitalRestantDu > 0 && (
              <Line yAxisId="euro" type="monotone" dataKey="capitalRestant" stroke="#ef4444" strokeWidth={1.5} strokeDasharray="4 2" dot={false} name="Capital dû" />
            )}
            {analysis.triMax !== null && (
              <Line yAxisId="roi" type="monotone" dataKey="tri" stroke="#01696e" strokeWidth={1.5} strokeDasharray="4 2" dot={false} name="TRI%" connectNulls />
            )}
            {analysis.cocMax !== null && (
              <Line yAxisId="roi" type="monotone" dataKey="cocReturn" stroke="#f59e0b" strokeWidth={1} strokeDasharray="2 2" dot={false} name="CoC%" connectNulls />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Message explicatif */}
      <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800 leading-relaxed">
        {analysis.moisRestants > 0 && optimalPoint ? (
          <>
            Fenêtre optimale basée sur le TRI :{' '}
            <strong>{fmtMonthYear(analysis.dateOptimale)}</strong>
            {analysis.triMax !== null && (
              <> — TRI max <strong>{analysis.triMax.toFixed(1)}%/an</strong></>
            )}.{' '}
            Capital restant dû à cette date :{' '}
            <strong>{optimalPoint.capitalRestant.toLocaleString('fr-FR')} €</strong>.{' '}
            Plus-value nette estimée : <strong>{optimalPoint.plusValue.toLocaleString('fr-FR')} €</strong>.{' '}
            CA mensuel moyen : <strong>{analysis.caMensuelMoyen.toLocaleString('fr-FR')} €/mois</strong>.
          </>
        ) : (
          <>
            Le moment optimal de revente est <strong>maintenant</strong> — le ROI est en déclin.{' '}
            Plus-value nette actuelle : <strong>{analysis.plusValueNette.toLocaleString('fr-FR')} €</strong>.
            {analysis.triActuel !== null && (
              <> TRI actuel : <strong>{analysis.triActuel.toFixed(1)}%/an</strong>.</>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function ValeurReventeSection({ vehicleId, purchasePrice, currentMileage, settings, marketValueJ0, depreciationRate }: {
  vehicleId: string; purchasePrice: number | null; currentMileage: number;
  settings: { autobizApiKey?: string | null; depreciationThreshold?: number };
  marketValueJ0: number | null; depreciationRate: number | null;
}): React.JSX.Element {
  const qc = useQueryClient();
  const [j0, setJ0] = useState(marketValueJ0 != null ? String(marketValueJ0) : '');
  const [pente, setPente] = useState(depreciationRate != null ? String(depreciationRate) : '');
  const saveJ0Mut = useMutation({
    mutationFn: () => api.patch(`/vehicles/${vehicleId}`, {
      ...(j0 !== '' ? { marketValueJ0: parseFloat(j0) } : {}),
      ...(pente !== '' ? { depreciationRate: parseFloat(pente) } : {}),
    }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['vehicle', vehicleId] }),
  });
  const { data } = useQuery<{ valuations: VehicleValuation[] }>({
    queryKey: ['valuations', vehicleId],
    queryFn: () => api.get<{ valuations: VehicleValuation[] }>(`/vehicles/${vehicleId}/valuations`).then(r => r.data),
    staleTime: 60 * 60_000,
  });
  const [manual, setManual] = useState('');
  const addMut = useMutation({
    mutationFn: () => api.post(`/vehicles/${vehicleId}/valuations`, { estimatedValue: parseFloat(manual), source: 'manual' }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['valuations', vehicleId] }); setManual(''); },
  });

  const valuations = data?.valuations ?? [];
  const latest = valuations[0];
  const threshold = settings.depreciationThreshold ?? 0.10;

  const depreciationPerKm = purchasePrice && latest && currentMileage > 0
    ? (purchasePrice - latest.estimatedValue) / currentMileage : null;
  const shouldSell = depreciationPerKm !== null && depreciationPerKm > threshold;

  const hasAutobiz = Boolean(settings.autobizApiKey);

  const chartData = [...valuations].reverse().map(v => ({
    date: new Date(v.evaluatedAt).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }),
    valeur: Math.round(v.estimatedValue),
  }));

  return (
    <div data-testid="valeur-revente-section" className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">Valeur & Revente</h2>

      {!hasAutobiz && valuations.length === 0 ? (
        <p className="text-sm text-gray-400 italic">
          Connectez Autobiz dans Paramètres pour estimer la valeur de revente, ou saisissez une valeur manuelle.
        </p>
      ) : latest ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div>
              <p className="text-xs text-gray-500">Valeur estimée</p>
              <p className="text-xl font-bold text-gray-900">{latest.estimatedValue.toLocaleString('fr-FR')} €</p>
              <p className="text-[11px] text-gray-400">{new Date(latest.evaluatedAt).toLocaleDateString('fr-FR')} · {latest.source}</p>
            </div>
            {shouldSell && (
              <span className="ml-auto inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
                Moment optimal pour revendre
              </span>
            )}
          </div>
          {depreciationPerKm !== null && (
            <p className="text-xs text-gray-500">
              Dépréciation : <span className="font-semibold text-gray-700">{depreciationPerKm.toFixed(3)} €/km</span>
              {' '}(seuil : {threshold} €/km)
            </p>
          )}
          {chartData.length > 1 && (
            <ResponsiveContainer width="100%" height={90}>
              <LineChart data={chartData}>
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${Math.round(v / 1000)}k`} width={30} />
                <Tooltip formatter={(v: number) => [`${v.toLocaleString('fr-FR')} €`, 'Valeur']} />
                <Line type="monotone" dataKey="valeur" stroke="#01696e" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      ) : null}

      <div className="mt-3 flex gap-2">
        <input type="number" min="0" step="100" value={manual}
          onChange={e => setManual(e.target.value)}
          placeholder="Estimation manuelle (€)"
          className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
        <button type="button" disabled={!manual || addMut.isPending}
          onClick={() => addMut.mutate()}
          className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          style={{ backgroundColor: '#01696e' }}>
          Ajouter
        </button>
      </div>

      <div className="mt-4 border-t border-gray-100 pt-4">
        <p className="mb-2 text-xs font-semibold text-gray-700">Modèle de dépréciation</p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-xs text-gray-500">Valeur pro J0 (€)</label>
            <input type="number" min="0" step="100" value={j0}
              onChange={e => setJ0(e.target.value)}
              placeholder="Ex : 16 000"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">Pente €/mois (0 = auto)</label>
            <input type="number" min="0" step="10" value={pente}
              onChange={e => setPente(e.target.value)}
              placeholder="Auto-calibrée"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
          </div>
        </div>
        <button type="button" disabled={saveJ0Mut.isPending}
          onClick={() => saveJ0Mut.mutate()}
          className="mt-2 rounded-lg px-4 py-1.5 text-xs font-medium text-white disabled:opacity-60"
          style={{ backgroundColor: '#01696e' }}>
          Enregistrer
        </button>
      </div>
    </div>
  );
}

function GarantiesSection({ vehicleId, warrantyAlertDays }: { vehicleId: string; warrantyAlertDays: number }): React.JSX.Element {
  const qc = useQueryClient();
  const { data } = useQuery<{ warranty: VehicleWarranty | null }>({
    queryKey: ['warranty', vehicleId],
    queryFn: () => api.get<{ warranty: VehicleWarranty | null }>(`/vehicles/${vehicleId}/warranty`).then(r => r.data),
    staleTime: 60 * 60_000,
  });
  const w = data?.warranty;
  const [form, setForm] = useState({
    warrantyStartDate: '', warrantyMonths: '', warrantyExtension: false, warrantyExtensionEnd: '',
    warrantyTires: false, warrantyTiresEnd: '', notes: '',
  });
  const [editing, setEditing] = useState(false);

  React.useEffect(() => {
    if (w) {
      setForm({
        warrantyStartDate: w.warrantyStartDate ? w.warrantyStartDate.slice(0, 10) : '',
        warrantyMonths: w.warrantyMonths ? String(w.warrantyMonths) : '',
        warrantyExtension: w.warrantyExtension,
        warrantyExtensionEnd: w.warrantyExtensionEnd ? w.warrantyExtensionEnd.slice(0, 10) : '',
        warrantyTires: w.warrantyTires,
        warrantyTiresEnd: w.warrantyTiresEnd ? w.warrantyTiresEnd.slice(0, 10) : '',
        notes: w.notes ?? '',
      });
    }
  }, [w]);

  const saveMut = useMutation({
    mutationFn: () => api.put(`/vehicles/${vehicleId}/warranty`, {
      ...form,
      warrantyMonths: form.warrantyMonths ? parseInt(form.warrantyMonths) : null,
    }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['warranty', vehicleId] }); setEditing(false); },
  });

  const expiryDate = form.warrantyStartDate && form.warrantyMonths
    ? new Date(new Date(form.warrantyStartDate).setMonth(new Date(form.warrantyStartDate).getMonth() + parseInt(form.warrantyMonths)))
    : null;
  const daysLeft = expiryDate ? Math.ceil((expiryDate.getTime() - Date.now()) / 86_400_000) : null;
  const isAlert = daysLeft !== null && daysLeft <= warrantyAlertDays && daysLeft >= 0;
  const isExpired = daysLeft !== null && daysLeft < 0;

  return (
    <div data-testid="garanties-section" className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Garanties</h2>
        <button type="button" onClick={() => setEditing(e => !e)}
          className="text-xs text-[#01696e] hover:underline">{editing ? 'Annuler' : 'Modifier'}</button>
      </div>

      {!editing ? (
        <div className="space-y-2 text-sm">
          {w ? (
            <>
              <div className="flex justify-between">
                <span className="text-gray-500">Garantie constructeur</span>
                <span className="font-medium text-gray-900">
                  {expiryDate ? expiryDate.toLocaleDateString('fr-FR') : '—'}
                  {isAlert && !isExpired && <span className="ml-2 text-amber-600 text-xs">J−{daysLeft}</span>}
                  {isExpired && <span className="ml-2 text-red-600 text-xs">Expirée</span>}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Extension</span>
                <span className="font-medium">{w.warrantyExtension ? (w.warrantyExtensionEnd ? new Date(w.warrantyExtensionEnd).toLocaleDateString('fr-FR') : 'Oui') : 'Non'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Garantie pneus</span>
                <span className="font-medium">{w.warrantyTires ? (w.warrantyTiresEnd ? new Date(w.warrantyTiresEnd).toLocaleDateString('fr-FR') : 'Oui') : 'Non'}</span>
              </div>
              {w.notes && <p className="text-xs text-gray-400 pt-1">{w.notes}</p>}
            </>
          ) : (
            <p className="text-sm text-gray-400">Aucune garantie enregistrée</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Début garantie</label>
              <input type="date" value={form.warrantyStartDate} onChange={e => setForm(f => ({ ...f, warrantyStartDate: e.target.value }))}
                data-testid="input-warranty-start"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Durée (mois)</label>
              <input type="number" min="1" value={form.warrantyMonths} onChange={e => setForm(f => ({ ...f, warrantyMonths: e.target.value }))}
                data-testid="input-warranty-months"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
            </div>
          </div>
          {expiryDate && (
            <p className="text-xs text-[#01696e]">Expiration calculée : {expiryDate.toLocaleDateString('fr-FR')}</p>
          )}
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input type="checkbox" checked={form.warrantyExtension} onChange={e => setForm(f => ({ ...f, warrantyExtension: e.target.checked }))} className="accent-[#01696e]" />
              Extension garantie
            </label>
            {form.warrantyExtension && (
              <input type="date" value={form.warrantyExtensionEnd} onChange={e => setForm(f => ({ ...f, warrantyExtensionEnd: e.target.value }))}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-[#01696e]" />
            )}
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input type="checkbox" checked={form.warrantyTires} onChange={e => setForm(f => ({ ...f, warrantyTires: e.target.checked }))} className="accent-[#01696e]" />
              Garantie pneus
            </label>
            {form.warrantyTires && (
              <input type="date" value={form.warrantyTiresEnd} onChange={e => setForm(f => ({ ...f, warrantyTiresEnd: e.target.value }))}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-[#01696e]" />
            )}
          </div>
          <textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            placeholder="Notes libres…"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e] resize-none" />
          <button type="button" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}
            className="w-full rounded-xl py-2 text-sm font-semibold text-white disabled:opacity-60"
            style={{ backgroundColor: '#01696e' }}>
            {saveMut.isPending ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      )}
    </div>
  );
}

function QRCodeModal({ vehicleId, licensePlate, onClose }: { vehicleId: string; licensePlate: string; onClose: () => void }): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const url = `${window.location.origin}/public/vehicles/${licensePlate.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

  const download = useCallback(() => {
    const canvas = document.getElementById('qr-canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `qr-${vehicleId}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }, [vehicleId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="rounded-2xl bg-white p-6 shadow-2xl space-y-4 w-72" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">QR Code véhicule</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
        </div>
        <div className="flex justify-center">
          <QRCodeCanvas id="qr-canvas" ref={canvasRef} value={url} size={200} level="H" />
        </div>
        <p className="text-[11px] text-gray-400 text-center break-all">{url}</p>
        <button type="button" onClick={download}
          className="w-full rounded-xl py-2 text-sm font-semibold text-white"
          style={{ backgroundColor: '#01696e' }}>
          Télécharger PNG
        </button>
      </div>
    </div>
  );
}

function CoutKmSection({ vehicleId, totalMonthlyCosts }: { vehicleId: string; totalMonthlyCosts: number }): React.JSX.Element {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const { data } = useQuery<{ month: string; kmTotal: number }>({
    queryKey: ['monthly-km', vehicleId, currentMonth],
    queryFn: () => api.get<{ month: string; kmTotal: number }>(`/vehicles/${vehicleId}/monthly-km`, { params: { month: currentMonth } }).then(r => r.data),
    enabled: Boolean(vehicleId),
    staleTime: 10 * 60_000,
  });
  const kmTotal = data?.kmTotal ?? 0;
  const coutParKm = kmTotal > 0 ? totalMonthlyCosts / kmTotal : null;

  return (
    <div data-testid="cout-km-section" className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">Coût réel au km</h2>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-500">Km parcourus ({currentMonth})</span>
          <span className="font-semibold text-gray-900">{kmTotal.toLocaleString('fr-FR')} km</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Charges mensuelles</span>
          <span className="font-semibold text-red-600">{totalMonthlyCosts.toFixed(2)} €</span>
        </div>
        <div className="flex justify-between border-t border-gray-100 pt-2">
          <span className="text-gray-700 font-medium">Coût / km</span>
          <span className={`font-bold text-base ${coutParKm === null ? 'text-gray-400' : 'text-[#01696e]'}`}>
            {coutParKm !== null ? `${coutParKm.toFixed(2)} €/km` : '— (km non disponibles)'}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function VehicleDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.isSuperAdmin;

  const [activeTab, setActiveTab] = useState<'overview' | 'costs'>('overview');
  const [showQR, setShowQR] = useState(false);

  const [costLabel, setCostLabel] = useState('');
  const [costAmount, setCostAmount] = useState('');

  const { data: costs = [], refetch: refetchCosts } = useQuery<VehicleCost[]>({
    queryKey: ['vehicle-costs', id],
    queryFn: () => api.get<{ costs: VehicleCost[] }>(`/vehicles/${id}/costs`).then(r => r.data.costs),
    enabled: Boolean(id),
    staleTime: 2 * 60_000,
  });

  const addCost = useMutation({
    mutationFn: () => api.post(`/vehicles/${id}/costs`, { label: costLabel, amount: parseFloat(costAmount) }),
    onSuccess: () => { void refetchCosts(); setCostLabel(''); setCostAmount(''); },
  });

  const deleteCost = useMutation({
    mutationFn: (costId: string) => api.delete(`/vehicles/${id}/costs/${costId}`),
    onSuccess: () => { void refetchCosts(); },
  });

  const [editingCostId, setEditingCostId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editAmount, setEditAmount] = useState('');

  const updateCost = useMutation({
    mutationFn: ({ costId, label, amount }: { costId: string; label: string; amount: number }) =>
      api.put(`/vehicles/${id}/costs/${costId}`, { label, amount }),
    onSuccess: () => { void refetchCosts(); setEditingCostId(null); },
  });

  const totalMonthlyCosts = costs.reduce((s, c) => s + c.amount, 0);

  const { data: settingsData } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<{ settings: { autobizApiKey?: string | null; depreciationThreshold?: number; warrantyAlertDays?: number } }>('/settings').then(r => r.data.settings),
    staleTime: 10 * 60_000,
    enabled: Boolean(isAdmin),
  });
  const vehicleSettings = {
    ...(settingsData?.autobizApiKey !== undefined ? { autobizApiKey: settingsData.autobizApiKey } : {}),
    depreciationThreshold: settingsData?.depreciationThreshold ?? 0.10,
    warrantyAlertDays: settingsData?.warrantyAlertDays ?? 30,
  };

  const saveCritAir = useMutation({
    mutationFn: (critAir: string | null) => api.patch(`/vehicles/${id}`, { critAir }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['vehicle', id] }),
  });

  const [blockingModal, setBlockingModal] = useState(false);
  const [blockingForm, setBlockingForm] = useState<BlockingFormData>(emptyForm);
  const [editingBlockingId, setEditingBlockingId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [gpsWarning, setGpsWarning] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<VehiclePhoto | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const now = new Date();
  const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [ratingValue, setRatingValue] = useState('');
  const [ratingReviewCount, setRatingReviewCount] = useState('');
  const [ratingKeywords, setRatingKeywords] = useState<string[]>([]);
  const [ratingNotes, setRatingNotes] = useState('');

  const { data: vehicle, isLoading, isError } = useQuery({
    queryKey: ['vehicle', id],
    queryFn: () => vehiclesApi.get(id!),
    enabled: Boolean(id),
    staleTime: 5 * 60_000,
  });

  const { data: blockings = [], refetch: refetchBlockings } = useQuery({
    queryKey: ['blockings', id],
    queryFn: () => blockingsApi.list(id!),
    enabled: Boolean(id),
    staleTime: 2 * 60_000,
  });

  const { data: carkeepers = [], refetch: refetchCarkeepers } = useQuery({
    queryKey: ['vehicle-carkeepers', id],
    queryFn: () => vehicleCarkeepersApi.list(id!),
    enabled: Boolean(id) && Boolean(isAdmin),
    staleTime: 2 * 60_000,
  });

  const { data: allUsers = [] } = useQuery<Array<{ id: string; name: string; email: string; role: string }>>({
    queryKey: ['users'],
    queryFn: () => api.get<{ users: Array<{ id: string; name: string; email: string; role: string }> }>('/users').then(r => r.data.users),
    enabled: Boolean(isAdmin),
    staleTime: 5 * 60_000,
  });

  const carekeeperUsers = allUsers.filter(u => u.role === 'carkeeper');
  const assignedIds = new Set(carkeepers.map(c => c.userId));
  const unassignedCarkeepers = carekeeperUsers.filter(u => !assignedIds.has(u.id));

  const assignCarkeeper = useMutation({
    mutationFn: (userId: string) => vehicleCarkeepersApi.assign(id!, userId),
    onSuccess: () => { void refetchCarkeepers(); },
  });

  const removeCarkeeper = useMutation({
    mutationFn: (userId: string) => vehicleCarkeepersApi.remove(id!, userId),
    onSuccess: () => { void refetchCarkeepers(); },
  });

  const { data: photos = [], refetch: refetchPhotos } = useQuery<VehiclePhoto[]>({
    queryKey: ['vehicle-photos', id],
    queryFn: () => vehiclePhotosApi.list(id!),
    enabled: Boolean(id),
    staleTime: 2 * 60_000,
  });

  const { data: ratings = [], refetch: refetchRatings } = useQuery<VehicleRating[]>({
    queryKey: ['vehicle-ratings', id],
    queryFn: () => vehicleRatingsApi.list(id!),
    enabled: Boolean(id),
    staleTime: 5 * 60_000,
  });

  const upsertRating = useMutation({
    mutationFn: () => vehicleRatingsApi.upsert(id!, {
      rating: parseFloat(ratingValue),
      reviewCount: ratingReviewCount ? parseInt(ratingReviewCount, 10) : 0,
      keywords: ratingKeywords,
      ...(ratingNotes ? { notes: ratingNotes } : {}),
    }),
    onSuccess: (saved) => {
      void refetchRatings();
      setRatingValue(String(saved.rating));
      setRatingReviewCount(String(saved.reviewCount));
      setRatingKeywords(saved.keywords);
      setRatingNotes(saved.notes ?? '');
    },
  });

  const sortedPhotos = [...photos].sort((a, b) => (b.isCover ? 1 : 0) - (a.isCover ? 1 : 0));

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const files = Array.from(e.target.files ?? []);
    if (!files.length || !id) return;
    setGpsWarning(false);
    for (const file of files) {
      setUploadProgress(0);
      try {
        const { gpsWarning: warn } = await vehiclePhotosApi.upload(id, file, setUploadProgress);
        if (warn) setGpsWarning(true);
      } catch (err) { console.error('[Upload]', err); }
    }
    setUploadProgress(null);
    e.target.value = '';
    void refetchPhotos();
  }

  const deleteMutation = useMutation({
    mutationFn: () => vehiclesApi.delete(id!),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['vehicles'] });
      navigate('/vehicles');
    },
  });

  const createBlocking = useMutation({
    mutationFn: (data: BlockingFormData) => blockingsApi.create({
      vehicleId: id!,
      startAt: new Date(data.startAt).toISOString(),
      endAt: new Date(data.endAt).toISOString(),
      ...(data.reason ? { reason: data.reason } : {}),
      type: data.type,
    }),
    onSuccess: () => {
      void refetchBlockings();
      setBlockingModal(false);
      setBlockingForm(emptyForm);
      setEditingBlockingId(null);
    },
  });

  const updateBlocking = useMutation({
    mutationFn: ({ blockingId, data }: { blockingId: string; data: BlockingFormData }) =>
      blockingsApi.update(blockingId, {
        startAt: new Date(data.startAt).toISOString(),
        endAt: new Date(data.endAt).toISOString(),
        reason: data.reason || null,
        type: data.type,
      }),
    onSuccess: () => {
      void refetchBlockings();
      setBlockingModal(false);
      setBlockingForm(emptyForm);
      setEditingBlockingId(null);
    },
  });

  const deleteBlocking = useMutation({
    mutationFn: (blockingId: string) => blockingsApi.delete(blockingId),
    onSuccess: () => { void refetchBlockings(); },
  });

  function openCreateModal() {
    setEditingBlockingId(null);
    setBlockingForm(emptyForm);
    setBlockingModal(true);
  }

  function openEditModal(b: typeof blockings[number]) {
    setEditingBlockingId(b.id);
    setBlockingForm({
      startAt: b.startAt.slice(0, 16),
      endAt: b.endAt.slice(0, 16),
      reason: b.reason ?? '',
      type: b.type as typeof BLOCKING_TYPES[number],
    });
    setBlockingModal(true);
  }

  function handleBlockingSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (editingBlockingId) {
      updateBlocking.mutate({ blockingId: editingBlockingId, data: blockingForm });
    } else {
      createBlocking.mutate(blockingForm);
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" style={{ borderColor: '#01696e', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  if (isError || !vehicle) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Véhicule introuvable.
        </div>
        <Link to="/vehicles" className="mt-4 inline-block text-sm text-[#01696e] hover:underline">
          ← Retour à la flotte
        </Link>
      </div>
    );
  }

  const lastCT = vehicle.maintenanceTasks?.find(t => t.type === 'ct') ?? null;

  return (<>
    <div className="p-4 lg:p-6">
      {/* Fil d'Ariane + actions */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <Link to="/vehicles" className="text-gray-400 hover:text-gray-600">Flotte</Link>
          <span className="text-gray-300">/</span>
          <span className="font-medium text-gray-900">{vehicle.make} {vehicle.model}</span>
        </div>
        <div className="flex gap-2">
          <Link
            to={`/vehicles/${id}/edit`}
            data-testid="btn-modifier"
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
          >
            Modifier
          </Link>
          <button
            type="button"
            onClick={() => {
              if (confirm('Désactiver ce véhicule ?')) deleteMutation.mutate();
            }}
            className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 shadow-sm hover:bg-red-50"
          >
            Désactiver
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1 w-fit">
        {(['overview', 'costs'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
              activeTab === tab ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab === 'overview' ? 'Vue générale' : 'Coûts'}
          </button>
        ))}
      </div>

      {activeTab === 'costs' && (
        <div className="space-y-4 mb-6">
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Ajouter un coût fixe</h2>
              <DocumentScanner
                type="invoice"
                label="Scanner une facture"
                onResult={(data) => {
                  if (data.label) setCostLabel(data.label as string);
                  if (data.amountMonthly) setCostAmount(String(data.amountMonthly));
                  else if (data.amount && data.period === 'annuel') setCostAmount(String(Math.round((data.amount as number) / 12 * 100) / 100));
                  else if (data.amount) setCostAmount(String(data.amount));
                }}
              />
            </div>
            <form
              onSubmit={(e) => { e.preventDefault(); if (costLabel && costAmount) addCost.mutate(); }}
              className="flex flex-wrap gap-3"
            >
              <input
                type="text"
                placeholder="Libellé (ex : Assurance)"
                value={costLabel}
                onChange={(e) => setCostLabel(e.target.value)}
                required
                className="flex-1 min-w-40 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#01696e]/30"
              />
              <input
                type="number"
                placeholder="Montant (€/mois)"
                value={costAmount}
                onChange={(e) => setCostAmount(e.target.value)}
                required
                min="0"
                step="0.01"
                className="w-40 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#01696e]/30"
              />
              <button
                type="submit"
                disabled={!costLabel || !costAmount || addCost.isPending}
                className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                style={{ backgroundColor: '#01696e' }}
              >
                Ajouter
              </button>
            </form>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Coûts fixes mensuels</h2>
              <div className="text-right">
                <p className="text-xs text-gray-400">Total mensuel</p>
                <p className="text-lg font-bold text-gray-900">{totalMonthlyCosts.toFixed(2)} €</p>
              </div>
            </div>

            {costs.length === 0 ? (
              <p className="text-sm text-gray-400">Aucun coût enregistré</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {costs.map((cost) => (
                  <div key={cost.id} className="py-3">
                    {editingCostId === cost.id ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <input type="text" value={editLabel} onChange={e => setEditLabel(e.target.value)}
                          className="flex-1 min-w-32 rounded-lg border border-[#01696e] px-3 py-1.5 text-sm focus:outline-none" />
                        <input type="number" value={editAmount} onChange={e => setEditAmount(e.target.value)}
                          min="0" step="0.01"
                          className="w-28 rounded-lg border border-[#01696e] px-3 py-1.5 text-sm focus:outline-none" />
                        <button type="button" disabled={updateCost.isPending}
                          onClick={() => updateCost.mutate({ costId: cost.id, label: editLabel, amount: parseFloat(editAmount) })}
                          className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                          style={{ backgroundColor: '#01696e' }}>OK</button>
                        <button type="button" onClick={() => setEditingCostId(null)}
                          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50">Annuler</button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{cost.label}</p>
                          <p className="text-xs text-gray-400 capitalize">{cost.type}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-gray-700">{cost.amount.toFixed(2)} €</span>
                          <button type="button" title="Modifier"
                            onClick={() => { setEditingCostId(cost.id); setEditLabel(cost.label); setEditAmount(String(cost.amount)); }}
                            className="rounded p-1 text-gray-400 hover:text-[#01696e]">
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button type="button" title="Supprimer"
                            onClick={() => { if (confirm(`Supprimer "${cost.label}" ?`)) deleteCost.mutate(cost.id); }}
                            className="rounded p-1 text-gray-400 hover:text-red-500">
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {costs.length > 0 && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-xs font-medium text-amber-700">Seuil de rentabilité mensuel</p>
                <p className="mt-0.5 text-base font-bold text-amber-800">{totalMonthlyCosts.toFixed(2)} € de revenus nécessaires pour couvrir les coûts fixes</p>
              </div>
            )}
          </div>
        </div>
      )}

      <div className={activeTab !== 'overview' ? 'hidden' : ''}>
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Colonne gauche — infos principales */}
        <div className="lg:col-span-2 space-y-4">
          {/* Photo + titre */}
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            {vehicle.photoUrl ? (
              <img
                src={vehicle.photoUrl}
                alt={`${vehicle.make} ${vehicle.model}`}
                className="h-48 w-full object-cover"
              />
            ) : (
              <div className="flex h-48 items-center justify-center bg-gray-100">
                <svg className="h-16 w-16 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
            )}
            <div className="p-5">
              <div className="flex items-center justify-between">
                <h1 className="text-xl font-bold text-gray-900">
                  {vehicle.make} {vehicle.model} {vehicle.year}
                </h1>
                <span
                  className={`rounded-full px-3 py-1 text-sm font-semibold ${
                    vehicle.healthScore >= 80 ? 'bg-green-100 text-green-700' :
                    vehicle.healthScore >= 50 ? 'bg-yellow-100 text-yellow-700' :
                    'bg-red-100 text-red-700'
                  }`}
                >
                  Score {vehicle.healthScore}/100
                </span>
              </div>
              <p className="mt-1 font-mono text-sm font-medium text-gray-500">{vehicle.licensePlate}</p>
            </div>
          </div>

          <Section title="Informations">
            <InfoRow label="Couleur" value={vehicle.color} />
            <InfoRow label="Kilométrage" value={`${vehicle.currentMileage.toLocaleString('fr-FR')} km`} />
            <InfoRow label="Statut" value={vehicle.isActive ? 'Actif' : 'Inactif'} />
            {vehicle.deliveryPointName && (
              <InfoRow
                label="Point de livraison"
                value={vehicle.deliveryPostalCode ? `${vehicle.deliveryPointName} — ${vehicle.deliveryPostalCode}` : vehicle.deliveryPointName}
              />
            )}
            {vehicle.getaroundId && <InfoRow label="ID Getaround" value={vehicle.getaroundId} />}
            {vehicle.getaroundAccount && <InfoRow label="Compte Getaround" value={vehicle.getaroundAccount.name} />}
            {vehicle.thirdPartyOwner && <InfoRow label="Propriétaire tiers" value={vehicle.thirdPartyOwner.name} />}
          </Section>

          {/* Instructions départ / retour */}
          {(vehicle.pickupInstructions ?? vehicle.returnInstructions) && (
            <Section title="Instructions locataire">
              {vehicle.pickupInstructions && (
                <div className="mb-4">
                  <p className="mb-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Départ</p>
                  <p className="whitespace-pre-wrap rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5 text-sm text-gray-700 leading-relaxed">
                    {vehicle.pickupInstructions}
                  </p>
                </div>
              )}
              {vehicle.returnInstructions && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Retour</p>
                  <p className="whitespace-pre-wrap rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5 text-sm text-gray-700 leading-relaxed">
                    {vehicle.returnInstructions}
                  </p>
                </div>
              )}
            </Section>
          )}

          {/* Blocages */}
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Blocages</h2>
              <button
                type="button"
                onClick={openCreateModal}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white"
                style={{ backgroundColor: '#01696e' }}
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Ajouter
              </button>
            </div>
            {blockings.length === 0 ? (
              <p className="text-sm text-gray-400">Aucun blocage</p>
            ) : (
              <div className="space-y-2">
                {blockings.map((b) => (
                  <div key={b.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2.5 text-sm">
                    <div className="flex items-center gap-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BLOCKING_TYPE_COLORS[b.type]}`}>
                        {BLOCKING_TYPE_LABELS[b.type]}
                      </span>
                      <span className="text-gray-600">
                        {format(new Date(b.startAt), 'dd/MM/yy HH:mm', { locale: fr })} → {format(new Date(b.endAt), 'dd/MM/yy HH:mm', { locale: fr })}
                      </span>
                      {b.reason && <span className="text-gray-400">{b.reason}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openEditModal(b)}
                        className="rounded p-1 text-gray-400 hover:text-gray-600"
                        title="Modifier"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => { if (confirm('Supprimer ce blocage ?')) deleteBlocking.mutate(b.id); }}
                        className="rounded p-1 text-gray-400 hover:text-red-500"
                        title="Supprimer"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Derniers entretiens */}
          <Section title="Derniers entretiens">
            {vehicle.maintenances.length > 0 ? (
              <div className="space-y-2">
                {vehicle.maintenances.map((m) => (
                  <div key={m.id} className="flex items-center justify-between text-sm">
                    <span className="capitalize text-gray-700">{m.type}</span>
                    <span className="text-gray-400">
                      {format(new Date(m.performedAt), 'dd/MM/yyyy', { locale: fr })}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">Aucun entretien enregistré</p>
            )}
          </Section>

          {/* Photos */}
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Photos</h2>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadProgress !== null}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                style={{ backgroundColor: '#01696e' }}
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Ajouter une photo
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="hidden"
                onChange={(e) => { void handleFileChange(e); }}
              />
            </div>

            {uploadProgress !== null && (
              <div className="mb-3">
                <div className="h-1.5 w-full rounded-full bg-gray-100">
                  <div
                    className="h-1.5 rounded-full transition-all"
                    style={{ width: `${uploadProgress}%`, backgroundColor: '#01696e' }}
                  />
                </div>
                <p className="mt-1 text-xs text-gray-400 text-center">{uploadProgress}%</p>
              </div>
            )}

            {gpsWarning && (
              <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                </svg>
                Photo sans géolocalisation (GPS refusé ou indisponible)
              </div>
            )}

            {sortedPhotos.length === 0 ? (
              <p className="text-sm text-gray-400">Aucune photo</p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {sortedPhotos.map((photo) => (
                  <div key={photo.id} className="relative group">
                    <div className="aspect-[4/3] overflow-hidden rounded-lg bg-gray-100">
                      <img
                        src={photo.url}
                        alt=""
                        className="h-full w-full object-cover cursor-pointer"
                        onClick={() => setSelectedPhoto(photo)}
                      />
                    </div>
                    {photo.isCover && (
                      <span className="absolute top-1 left-1 rounded-full bg-[#01696e] px-2 py-0.5 text-[10px] font-semibold text-white">
                        Couverture
                      </span>
                    )}
                    {photo.latitude && (
                      <span className="absolute bottom-1 left-1 flex items-center gap-0.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                        <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        </svg>
                        GPS
                      </span>
                    )}
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm('Supprimer cette photo ?')) {
                            void vehiclePhotosApi.delete(id!, photo.id).then(() => refetchPhotos());
                          }
                        }}
                        className="absolute top-1 right-1 rounded-full bg-white/80 p-1 text-gray-500 opacity-0 group-hover:opacity-100 transition hover:text-red-500"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Colonne droite */}
        <div className="space-y-4">
          {/* Contrôle technique */}
          <Section title="Contrôle technique">
            {lastCT?.lastPerformedAt ? (
              <>
                {lastCT.ctResult && (
                  <InfoRow
                    label="Résultat"
                    value={<span className={RESULT_COLORS[lastCT.ctResult] ?? 'text-gray-500'}>{RESULT_LABELS[lastCT.ctResult] ?? lastCT.ctResult}</span>}
                  />
                )}
                <InfoRow
                  label="Réalisé le"
                  value={format(new Date(lastCT.lastPerformedAt), 'dd/MM/yyyy', { locale: fr })}
                />
                {lastCT.nextDueDate && (
                  <InfoRow
                    label="Prochain CT"
                    value={format(new Date(lastCT.nextDueDate), 'dd/MM/yyyy', { locale: fr })}
                  />
                )}
              </>
            ) : (
              <p className="text-sm text-gray-400">Aucun contrôle technique enregistré</p>
            )}
          </Section>

          {/* Documents */}
          <Section title="Documents">
            {vehicle.documents.length === 0 ? (
              <p className="text-sm text-gray-400">Aucun document</p>
            ) : (
              <div className="space-y-2">
                {vehicle.documents.map((d) => (
                  <div key={d.id} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700">{d.name}</span>
                    {d.expiryDate && (
                      <span className="text-xs text-gray-400">
                        {format(new Date(d.expiryDate), 'dd/MM/yy', { locale: fr })}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Accessoires */}
          {vehicle.accessories.length > 0 && (
            <Section title="Accessoires">
              <div className="flex flex-wrap gap-2">
                {vehicle.accessories.map((a) => (
                  <span key={a.accessoryId} className="rounded-full bg-[#01696e]/10 px-3 py-1 text-xs font-medium text-[#01696e]"
                    title={a.accessory.description ?? undefined}>
                    {a.accessory.name}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {/* Note Getaround mensuelle */}
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-400">Note Getaround</h2>

            {/* Formulaire saisie */}
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Note /5</label>
                  <input
                    data-testid="input-note-getaround"
                    type="number" min="0" max="5" step="0.1"
                    placeholder="ex : 4.2"
                    value={ratingValue}
                    onChange={e => setRatingValue(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#01696e]/30"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Nombre d'avis</label>
                  <input
                    data-testid="input-nb-avis"
                    type="number" min="0" step="1"
                    placeholder="ex : 12"
                    value={ratingReviewCount}
                    onChange={e => setRatingReviewCount(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#01696e]/30"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2">Mots-clés mentionnés</label>
                <div className="flex flex-wrap gap-2">
                  {RATING_KEYWORDS.map(kw => {
                    const active = ratingKeywords.includes(kw);
                    return (
                      <button
                        key={kw} type="button"
                        onClick={() => setRatingKeywords(prev =>
                          active ? prev.filter(k => k !== kw) : [...prev, kw]
                        )}
                        className={`rounded-full px-3 py-1 text-xs font-medium border transition ${
                          active
                            ? 'border-[#01696e] bg-[#01696e]/10 text-[#01696e]'
                            : 'border-gray-200 text-gray-500 hover:border-[#01696e]/40'
                        }`}
                      >
                        {kw}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Commentaire libre</label>
                <textarea
                  rows={2}
                  value={ratingNotes}
                  onChange={e => setRatingNotes(e.target.value)}
                  placeholder="Observations..."
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#01696e]/30 resize-none"
                />
              </div>

              <button
                data-testid="btn-sauvegarder-note"
                type="button"
                onClick={() => upsertRating.mutate()}
                disabled={!ratingValue || upsertRating.isPending}
                className="w-full rounded-lg py-2 text-sm font-semibold text-white disabled:opacity-60 transition"
                style={{ backgroundColor: '#01696e' }}
              >
                {upsertRating.isPending ? 'Enregistrement...' : `Enregistrer pour ${currentPeriod}`}
              </button>
              {upsertRating.isSuccess && (
                <p className="text-center text-xs text-green-600">Note enregistrée</p>
              )}
            </div>

            {/* Historique 6 derniers mois */}
            {ratings.length > 0 && (
              <div className="mt-5">
                <p className="mb-2 text-xs font-medium text-gray-400">Historique 6 mois</p>
                <ResponsiveContainer width="100%" height={100}>
                  <LineChart data={[...ratings].reverse().slice(0, 6)}>
                    <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                    <YAxis domain={[0, 5]} tick={{ fontSize: 10 }} width={20} />
                    <Tooltip formatter={(v: number) => [`${v}/5`, 'Note']} />
                    <Line type="monotone" dataKey="rating" stroke="#01696e" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
                <div className="mt-2 space-y-1">
                  {ratings.slice(0, 3).map(r => (
                    <div key={r.id} className="flex items-center justify-between text-xs text-gray-500">
                      <span>{r.period}</span>
                      <span className="font-medium text-gray-700">{r.rating}/5</span>
                      <span>{r.reviewCount} avis</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Coût réel au km */}
          <CoutKmSection vehicleId={id!} totalMonthlyCosts={totalMonthlyCosts} />

          {/* Crit'Air */}
          <div data-testid="critair-section" className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">Crit'Air</h2>
            <div className="flex items-center gap-3">
              <select
                data-testid="select-critair"
                value={vehicle.critAir ?? ''}
                onChange={e => saveCritAir.mutate(e.target.value || null)}
                className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]"
              >
                <option value="">Non renseigné</option>
                {Object.entries(CRITAIR_LABELS).map(([v, { label }]) => (
                  <option key={v} value={v}>{label}</option>
                ))}
              </select>
              {vehicle.critAir && (
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${CRITAIR_LABELS[vehicle.critAir]?.color ?? 'bg-gray-100 text-gray-600'}`}>
                  {vehicle.critAir}
                </span>
              )}
            </div>
          </div>

          {/* Valeur & Revente */}
          <ValeurReventeSection
            vehicleId={id!}
            purchasePrice={vehicle.purchasePrice ?? null}
            currentMileage={vehicle.currentMileage ?? 0}
            settings={vehicleSettings}
            marketValueJ0={vehicle.marketValueJ0 ?? null}
            depreciationRate={vehicle.depreciationRate ?? null}
          />

          {/* Analyse de revente ROI */}
          <RoiAnalysisSection
            vehicleId={id!}
            vehicle={vehicle as { purchasePrice?: number | null; purchaseDate?: string | null; marketValue?: number | null; marketValueDate?: string | null }}
          />

          {/* Garanties */}
          <GarantiesSection vehicleId={id!} warrantyAlertDays={vehicleSettings.warrantyAlertDays} />

          {/* QR Code */}
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">QR Code véhicule</h2>
            <button
              type="button"
              data-testid="btn-qr-code"
              onClick={() => setShowQR(true)}
              className="flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:border-[#01696e] hover:text-[#01696e] transition"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 3.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
              </svg>
              Afficher le QR Code
            </button>
            {showQR && (
              <QRCodeModal vehicleId={id!} licensePlate={vehicle.licensePlate} onClose={() => setShowQR(false)} />
            )}
          </div>

          {/* Carkeepers assignés — admin only */}
          {isAdmin && (
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-400">Carkeepers assignés</h2>
              {carkeepers.length === 0 ? (
                <p className="text-sm text-gray-400">Aucun carkeeper assigné</p>
              ) : (
                <div className="space-y-2 mb-3">
                  {carkeepers.map((c) => (
                    <div key={c.id} className="flex items-center justify-between text-sm">
                      <div>
                        <p className="font-medium text-gray-900">{c.user.name}</p>
                        <p className="text-xs text-gray-400">{c.user.email}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => { if (confirm(`Retirer ${c.user.name} ?`)) removeCarkeeper.mutate(c.userId); }}
                        className="rounded p-1 text-gray-400 hover:text-red-500"
                        title="Retirer"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {unassignedCarkeepers.length > 0 && (
                <select
                  defaultValue=""
                  onChange={(e) => { if (e.target.value) { assignCarkeeper.mutate(e.target.value); e.target.value = ''; } }}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#01696e]/30"
                >
                  <option value="" disabled>Assigner un carkeeper…</option>
                  {unassignedCarkeepers.map(u => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>
      </div>
      </div>{/* fin overview */}
    </div>

    {/* Modal métadonnées photo */}
    {selectedPhoto && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setSelectedPhoto(null)}>
        <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
          <img src={selectedPhoto.url} alt="" className="w-full max-h-64 object-cover" />
          <div className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Métadonnées</h3>
              <button type="button" onClick={() => setSelectedPhoto(null)} className="text-gray-400 hover:text-gray-600">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {selectedPhoto.latitude && selectedPhoto.longitude ? (
              <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 space-y-1">
                <p className="text-xs font-semibold text-blue-700">Position GPS</p>
                <p className="text-xs text-blue-600 font-mono">
                  {selectedPhoto.latitude.toFixed(6)}, {selectedPhoto.longitude.toFixed(6)}
                </p>
                {selectedPhoto.accuracy && (
                  <p className="text-xs text-blue-500">Précision : ±{Math.round(selectedPhoto.accuracy)} m</p>
                )}
                <a
                  href={`https://www.google.com/maps?q=${selectedPhoto.latitude},${selectedPhoto.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:underline"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  Voir sur Google Maps
                </a>
              </div>
            ) : (
              <p className="text-xs text-gray-400 italic">Aucune donnée GPS</p>
            )}

            <div className="divide-y divide-gray-100 text-xs">
              {selectedPhoto.takenAt && (
                <div className="flex justify-between py-2">
                  <span className="text-gray-500">Prise de vue</span>
                  <span className="font-medium text-gray-800">{format(new Date(selectedPhoto.takenAt), 'dd/MM/yyyy HH:mm', { locale: fr })}</span>
                </div>
              )}
              <div className="flex justify-between py-2">
                <span className="text-gray-500">Upload</span>
                <span className="font-medium text-gray-800">{format(new Date(selectedPhoto.uploadedAt), 'dd/MM/yyyy HH:mm', { locale: fr })}</span>
              </div>
              {selectedPhoto.deviceInfo && (
                <div className="py-2">
                  <p className="text-gray-500 mb-0.5">Appareil</p>
                  <p className="text-gray-700 break-all leading-snug" style={{ wordBreak: 'break-word' }}>
                    {selectedPhoto.deviceInfo.length > 80 ? selectedPhoto.deviceInfo.slice(0, 80) + '…' : selectedPhoto.deviceInfo}
                  </p>
                </div>
              )}
            </div>

            {isAdmin && !selectedPhoto.isCover && (
              <button
                type="button"
                onClick={async () => {
                  await vehiclePhotosApi.setCover(id!, selectedPhoto.id);
                  void refetchPhotos();
                  setSelectedPhoto(null);
                }}
                className="w-full rounded-lg py-2 text-sm font-medium text-white"
                style={{ backgroundColor: '#01696e' }}
              >
                Définir comme couverture
              </button>
            )}
          </div>
        </div>
      </div>
    )}

    {/* Modal Blocage */}
    {blockingModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
            <h3 className="font-semibold text-gray-900">
              {editingBlockingId ? 'Modifier le blocage' : 'Nouveau blocage'}
            </h3>
            <button type="button" onClick={() => setBlockingModal(false)} className="text-gray-400 hover:text-gray-600">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <form onSubmit={handleBlockingSubmit} className="p-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Début</label>
                <input
                  type="datetime-local"
                  required
                  value={blockingForm.startAt}
                  onChange={e => setBlockingForm(f => ({ ...f, startAt: e.target.value }))}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#01696e]/30"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Fin</label>
                <input
                  type="datetime-local"
                  required
                  value={blockingForm.endAt}
                  onChange={e => setBlockingForm(f => ({ ...f, endAt: e.target.value }))}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#01696e]/30"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Type</label>
              <select
                value={blockingForm.type}
                onChange={e => setBlockingForm(f => ({ ...f, type: e.target.value as typeof BLOCKING_TYPES[number] }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#01696e]/30"
              >
                {BLOCKING_TYPES.map(t => (
                  <option key={t} value={t}>{BLOCKING_TYPE_LABELS[t]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Raison (optionnel)</label>
              <input
                type="text"
                value={blockingForm.reason}
                onChange={e => setBlockingForm(f => ({ ...f, reason: e.target.value }))}
                placeholder="Ex: Vidange, Contrôle technique..."
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#01696e]/30"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setBlockingModal(false)}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={createBlocking.isPending || updateBlocking.isPending}
                className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                style={{ backgroundColor: '#01696e' }}
              >
                {editingBlockingId ? 'Enregistrer' : 'Créer'}
              </button>
            </div>
          </form>
        </div>
      </div>
    )}
  </>);
}
