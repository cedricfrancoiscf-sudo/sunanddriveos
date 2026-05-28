import React, { useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../utils/api';
import { captureGPS } from '../../utils/geoCapture';

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
  return Object.fromEntries(SECTIONS.map(s => [s.key, initSection(s.points.length)])) as CheckData;
}

function computeResult(data: CheckData): 'pass' | 'advisory' | 'fail' {
  const fails = Object.values(data).flat().filter(p => !p.ok).length;
  if (fails === 0) return 'pass';
  if (fails <= 3) return 'advisory';
  return 'fail';
}

const RESULT_INFO = {
  pass: { label: 'Favorable', color: 'bg-green-100 text-green-700', dot: 'bg-green-400' },
  advisory: { label: 'Défavorable mineur', color: 'bg-yellow-100 text-yellow-700', dot: 'bg-yellow-400' },
  fail: { label: 'Défavorable majeur', color: 'bg-red-100 text-red-700', dot: 'bg-red-400' },
};

function FuelGauge({ value, onChange }: { value: number; onChange: (v: number) => void }): React.JSX.Element {
  const color = value < 25 ? 'bg-red-500' : value < 50 ? 'bg-orange-400' : 'bg-green-500';
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-gray-600">⛽ Carburant</span>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${value < 25 ? 'bg-red-100 text-red-700' : value < 50 ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>
          {value}%
        </span>
      </div>
      <input type="range" min={0} max={100} step={5} value={value}
        onChange={e => onChange(parseInt(e.target.value, 10))}
        className="w-full h-2 rounded-full appearance-none cursor-pointer bg-gray-200" />
      <div className="mt-1 h-2 rounded-full bg-gray-200 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

export default function VehicleCheckFormPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const qc = useQueryClient();
  const photoInputRef = useRef<HTMLInputElement>(null);

  const preselectedVehicleId = searchParams.get('vehicleId') ?? '';

  const [vehicleId, setVehicleId] = useState(preselectedVehicleId);
  const [checkData, setCheckData] = useState<CheckData>(initForm());
  const [fuelLevel, setFuelLevel] = useState(75);
  const [mileage, setMileage] = useState('');
  const [notes, setNotes] = useState('');
  interface CheckPhoto { url: string; latitude?: number; longitude?: number; accuracy?: number; takenAt?: string; deviceInfo?: string; }
  const [photos, setPhotos] = useState<CheckPhoto[]>([]);
  const [checkGpsWarning, setCheckGpsWarning] = useState(false);
  const [activeSection, setActiveSection] = useState(0);
  const [submitted, setSubmitted] = useState(false);

  const { data: vehiclesData } = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => api.get<{ vehicles: { id: string; make: string; model: string; licensePlate: string }[] }>('/vehicles').then(r => r.data.vehicles),
    staleTime: 5 * 60_000,
  });

  const submitMutation = useMutation({
    mutationFn: (payload: object) => api.post('/vehicle-checks', payload).then(r => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['vehicle-checks'] });
      setSubmitted(true);
    },
  });

  function setPoint(sectionKey: SectionKey, idx: number, field: 'ok' | 'note', value: boolean | string) {
    setCheckData(prev => {
      const section = [...prev[sectionKey]];
      section[idx] = { ...section[idx]!, [field]: value };
      return { ...prev, [sectionKey]: section };
    });
  }

  function handlePhotoCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    setCheckGpsWarning(false);
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        if (typeof ev.target?.result !== 'string') return;
        const url = ev.target.result as string;
        const geo = await captureGPS();
        if (!geo) setCheckGpsWarning(true);
        setPhotos(prev => [...prev, {
          url,
          ...(geo ? { latitude: geo.latitude, longitude: geo.longitude, accuracy: geo.accuracy, takenAt: geo.takenAt, deviceInfo: geo.deviceInfo } : {}),
        }]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (!vehicleId) return;
    submitMutation.mutate({
      vehicleId,
      checkedAt: new Date().toISOString(),
      ...checkData,
      fuelLevel,
      mileage: mileage ? parseInt(mileage, 10) : undefined,
      notes: notes || undefined,
      photos,
      overallResult: computeResult(checkData),
    });
  }

  function openGetaround(): void {
    window.open('https://getaround.com/dashboard', '_blank', 'noopener,noreferrer');
  }

  const result = computeResult(checkData);
  const totalFails = Object.values(checkData).flat().filter(p => !p.ok).length;
  const section = SECTIONS[activeSection]!;
  const sectionData = checkData[section.key];
  const isLastSection = activeSection === SECTIONS.length - 1;

  if (submitted) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 p-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
          <svg className="h-8 w-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div>
          <p className="text-lg font-bold text-gray-900">✅ Validation SunanddriveOS terminée</p>
          <p className="mt-1 text-sm text-gray-500">Résultat : <span className={`font-semibold ${RESULT_INFO[result].color} px-2 rounded-full`}>{RESULT_INFO[result].label}</span></p>
          <p className="mt-3 text-sm text-gray-600">Finalisez dans l'app Getaround</p>
        </div>
        <div className="flex gap-3">
          <button type="button" onClick={openGetaround}
            className="rounded-xl px-5 py-2.5 text-sm font-bold text-white shadow"
            style={{ backgroundColor: '#01696e' }}>
            Ouvrir Getaround
          </button>
          <button type="button" onClick={() => navigate('/vehicle-checks')}
            className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
            Retour
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-gray-200 bg-white px-4 py-3 lg:px-6">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">Fiche contrôle terrain</h1>
          <span className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${RESULT_INFO[result].color}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${RESULT_INFO[result].dot}`} />
            {RESULT_INFO[result].label} · {totalFails} NOK
          </span>
        </div>
        <div className="mt-2">
          <select value={vehicleId} onChange={e => setVehicleId(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e] sm:w-auto">
            <option value="">Sélectionner un véhicule...</option>
            {vehiclesData?.map(v => <option key={v.id} value={v.id}>{v.make} {v.model} — {v.licensePlate}</option>)}
          </select>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-1 overflow-hidden flex-col lg:flex-row">
        {/* Navigation sections */}
        <nav className="shrink-0 border-b border-gray-200 bg-gray-50 lg:w-48 lg:border-b-0 lg:border-r">
          <div className="flex overflow-x-auto lg:flex-col lg:overflow-x-visible lg:py-2">
            {SECTIONS.map((s, i) => {
              const fails = checkData[s.key].filter(p => !p.ok).length;
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

          {/* Navigation + section finale */}
          <div className="mt-6 flex gap-2">
            {activeSection > 0 && (
              <button type="button" onClick={() => setActiveSection(i => i - 1)}
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                ← {SECTIONS[activeSection - 1]!.label}
              </button>
            )}
            {!isLastSection ? (
              <button type="button" onClick={() => setActiveSection(i => i + 1)}
                className="ml-auto rounded-xl px-4 py-2 text-sm font-semibold text-white" style={{ backgroundColor: '#01696e' }}>
                {SECTIONS[activeSection + 1]!.label} →
              </button>
            ) : (
              <div className="ml-auto flex-1 space-y-4">
                {/* Carburant */}
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                  <FuelGauge value={fuelLevel} onChange={setFuelLevel} />
                </div>

                {/* Kilométrage */}
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                  <label className="block text-xs font-medium text-gray-600 mb-2">Kilométrage actuel</label>
                  <input type="number" min={0} value={mileage} onChange={e => setMileage(e.target.value)}
                    placeholder="ex: 42500"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
                </div>

                {/* Photos */}
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-medium text-gray-600">Photos ({photos.length})</span>
                    <button type="button" onClick={() => photoInputRef.current?.click()}
                      className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      Prendre une photo
                    </button>
                    <input ref={photoInputRef} type="file" accept="image/*" capture="environment"
                      multiple onChange={handlePhotoCapture} className="hidden" />
                  </div>
                  {checkGpsWarning && (
                    <p className="text-xs text-amber-600 flex items-center gap-1">
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/></svg>
                      Photo sans géolocalisation
                    </p>
                  )}
                  {photos.length > 0 && (
                    <div className="flex gap-2 flex-wrap">
                      {photos.map((p, i) => (
                        <div key={i} className="relative">
                          <img src={p.url} alt={`Photo ${i + 1}`} className="h-16 w-16 rounded-lg object-cover border border-gray-200" />
                          {p.latitude && (
                            <span className="absolute bottom-0.5 left-0.5 rounded-full bg-black/60 px-1 text-[8px] text-white">GPS</span>
                          )}
                          <button type="button" onClick={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
                            className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white text-[10px] leading-none">
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Observations */}
                <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Observations générales (optionnel)..." rows={3}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />

                {/* Bouton final */}
                {submitMutation.isError && (
                  <p className="text-sm text-red-500">Erreur lors de l'enregistrement — réessayez.</p>
                )}
                <button type="submit" disabled={!vehicleId || submitMutation.isPending}
                  className="w-full rounded-xl py-3 text-sm font-bold text-white transition disabled:opacity-60 flex items-center justify-center gap-2"
                  style={{ backgroundColor: '#01696e' }}>
                  {submitMutation.isPending ? 'Enregistrement...' : (
                    <>
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Valider et ouvrir Getaround
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
