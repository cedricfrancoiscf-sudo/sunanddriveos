import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../utils/api';

// --- Définition des 9 sections de la fiche contrôle Sun and Drive ---
const SECTIONS = [
  { key: 'lighting', label: 'Éclairage', points: ['Feux avant gauche', 'Feux avant droit', 'Feux arrière gauche', 'Feux arrière droit', 'Feux de recul', 'Clignotants', 'Feux de détresse'] },
  { key: 'levels', label: 'Niveaux', points: ['Huile moteur', 'Liquide de refroidissement', 'Liquide de frein', 'Lave-glace', 'Direction assistée'] },
  { key: 'glazingMirrors', label: 'Vitrage & Rétroviseurs', points: ['Pare-brise (état)', 'Vitres latérales', 'Lunette arrière', 'Rétroviseur intérieur', 'Rétroviseurs extérieurs'] },
  { key: 'wipers', label: 'Essuie-glaces', points: ['Essuie-glace avant gauche', 'Essuie-glace avant droit', 'Essuie-glace arrière'] },
  { key: 'tires', label: 'Pneumatiques', points: ['Pneu avant gauche', 'Pneu avant droit', 'Pneu arrière gauche', 'Pneu arrière droit'] },
  { key: 'braking', label: 'Freinage', points: ['Frein de service (pédale)', 'Frein de stationnement', 'Freinage ABS'] },
  { key: 'engineBattery', label: 'Moteur & Batterie', points: ['Démarrage', 'Voyants tableau de bord', 'Courroie accessoires', 'Batterie', 'Niveau AdBlue'] },
  { key: 'safety', label: 'Sécurité', points: ['Ceintures de sécurité', 'Airbags (voyant)', 'Gilet & triangle', 'Extincteur', 'Klaxon'] },
  { key: 'roadTest', label: 'Essai routier', points: ['Accélération', 'Boîte de vitesses', 'Direction', 'Comportement freinage'] },
] as const;

type SectionKey = typeof SECTIONS[number]['key'];
type CheckPoint = { ok: boolean; note: string };
type CheckData = Record<SectionKey, CheckPoint[]>;

function initSection(count: number): CheckPoint[] {
  return Array.from({ length: count }, () => ({ ok: true, note: '' }));
}

function initForm(): CheckData {
  return Object.fromEntries(
    SECTIONS.map(s => [s.key, initSection(s.points.length)])
  ) as CheckData;
}

function computeResult(data: CheckData): 'pass' | 'advisory' | 'fail' {
  const all = Object.values(data).flat();
  const failCount = all.filter(p => !p.ok).length;
  if (failCount === 0) return 'pass';
  if (failCount <= 3) return 'advisory';
  return 'fail';
}

const RESULT_INFO = {
  pass: { label: 'Favorable', color: 'bg-green-100 text-green-700' },
  advisory: { label: 'Défavorable mineur', color: 'bg-yellow-100 text-yellow-700' },
  fail: { label: 'Défavorable majeur', color: 'bg-red-100 text-red-700' },
};

export default function VehicleCheckFormPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const qc = useQueryClient();

  const preselectedVehicleId = searchParams.get('vehicleId') ?? '';

  const [vehicleId, setVehicleId] = useState(preselectedVehicleId);
  const [checkData, setCheckData] = useState<CheckData>(initForm());
  const [notes, setNotes] = useState('');
  const [activeSection, setActiveSection] = useState(0);

  const { data: vehiclesData } = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => api.get<{ vehicles: { id: string; make: string; model: string; licensePlate: string }[] }>('/vehicles').then(r => r.data.vehicles),
    staleTime: 5 * 60_000,
  });

  const submitMutation = useMutation({
    mutationFn: (payload: object) =>
      api.post('/vehicle-checks', payload).then(r => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['vehicle-checks'] });
      navigate('/vehicle-checks');
    },
  });

  function setPoint(sectionKey: SectionKey, idx: number, field: 'ok' | 'note', value: boolean | string) {
    setCheckData(prev => {
      const section = [...prev[sectionKey]];
      section[idx] = { ...section[idx]!, [field]: value };
      return { ...prev, [sectionKey]: section };
    });
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (!vehicleId) return;
    submitMutation.mutate({
      vehicleId,
      checkedAt: new Date().toISOString(),
      ...checkData,
      notes,
      overallResult: computeResult(checkData),
    });
  }

  const result = computeResult(checkData);
  const totalFails = Object.values(checkData).flat().filter(p => !p.ok).length;
  const section = SECTIONS[activeSection]!;
  const sectionData = checkData[section.key];

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-gray-200 bg-white px-4 py-3 lg:px-6">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">Nouvelle fiche contrôle</h1>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${RESULT_INFO[result].color}`}>
            {RESULT_INFO[result].label} · {totalFails} point{totalFails !== 1 ? 's' : ''} NOK
          </span>
        </div>
        {/* Sélection véhicule */}
        <div className="mt-2">
          <select value={vehicleId} onChange={e => setVehicleId(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e] sm:w-auto">
            <option value="">Sélectionner un véhicule...</option>
            {vehiclesData?.map(v => <option key={v.id} value={v.id}>{v.make} {v.model} — {v.licensePlate}</option>)}
          </select>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-1 overflow-hidden flex-col lg:flex-row">
        {/* Navigation sections — sidebar sur desktop, onglets sur mobile */}
        <nav className="shrink-0 border-b border-gray-200 bg-gray-50 lg:w-48 lg:border-b-0 lg:border-r">
          <div className="flex overflow-x-auto lg:flex-col lg:overflow-x-visible lg:py-2">
            {SECTIONS.map((s, i) => {
              const sData = checkData[s.key];
              const fails = sData.filter(p => !p.ok).length;
              return (
                <button key={s.key} type="button" onClick={() => setActiveSection(i)}
                  className={`shrink-0 flex items-center justify-between gap-2 px-4 py-2.5 text-left text-sm transition lg:w-full ${activeSection === i ? 'font-semibold text-[#01696e] bg-[#01696e]/5' : 'text-gray-600 hover:bg-gray-100'}`}>
                  <span className="whitespace-nowrap lg:whitespace-normal">{s.label}</span>
                  {fails > 0 && <span className="shrink-0 rounded-full bg-red-100 px-1.5 text-xs font-bold text-red-600">{fails}</span>}
                </button>
              );
            })}
          </div>
        </nav>

        {/* Section courante */}
        <div className="flex-1 overflow-y-auto p-4 lg:p-6">
          <h2 className="mb-4 text-base font-semibold text-gray-900">{section.label}</h2>
          <div className="space-y-3">
            {section.points.map((label, idx) => {
              const point = sectionData[idx]!;
              return (
                <div key={idx} className={`rounded-xl border p-3 transition ${point.ok ? 'border-gray-200 bg-white' : 'border-red-200 bg-red-50'}`}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-gray-800">{label}</span>
                    <div className="flex gap-2 shrink-0">
                      <button type="button"
                        onClick={() => setPoint(section.key as SectionKey, idx, 'ok', true)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${point.ok ? 'bg-green-500 text-white' : 'border border-gray-200 bg-white text-gray-400 hover:bg-green-50'}`}>
                        OK
                      </button>
                      <button type="button"
                        onClick={() => setPoint(section.key as SectionKey, idx, 'ok', false)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${!point.ok ? 'bg-red-500 text-white' : 'border border-gray-200 bg-white text-gray-400 hover:bg-red-50'}`}>
                        NOK
                      </button>
                    </div>
                  </div>
                  {!point.ok && (
                    <input type="text" placeholder="Préciser le problème..."
                      value={point.note}
                      onChange={e => setPoint(section.key as SectionKey, idx, 'note', e.target.value)}
                      className="mt-2 w-full rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-red-400" />
                  )}
                </div>
              );
            })}
          </div>

          {/* Navigation entre sections */}
          <div className="mt-6 flex gap-2">
            {activeSection > 0 && (
              <button type="button" onClick={() => setActiveSection(i => i - 1)}
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                ← {SECTIONS[activeSection - 1]!.label}
              </button>
            )}
            {activeSection < SECTIONS.length - 1 ? (
              <button type="button" onClick={() => setActiveSection(i => i + 1)}
                className="ml-auto rounded-xl px-4 py-2 text-sm font-semibold text-white" style={{ backgroundColor: '#01696e' }}>
                {SECTIONS[activeSection + 1]!.label} →
              </button>
            ) : (
              <div className="ml-auto flex-1 space-y-3">
                <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Observations générales (optionnel)..." rows={3}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
                <button type="submit" disabled={!vehicleId || submitMutation.isPending}
                  className="w-full rounded-xl py-3 text-sm font-bold text-white transition disabled:opacity-60" style={{ backgroundColor: '#01696e' }}>
                  {submitMutation.isPending ? 'Enregistrement...' : `Valider la fiche (${RESULT_INFO[result].label})`}
                </button>
              </div>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
