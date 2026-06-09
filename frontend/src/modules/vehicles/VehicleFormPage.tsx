import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vehiclesApi } from './vehiclesApi';
import { DocumentScanner } from '../../components/ui/DocumentScanner';
import { api } from '../../utils/api';

const FUEL_TYPES = [
  { value: '', label: 'Non renseigné' },
  { value: 'essence', label: 'Essence' },
  { value: 'diesel', label: 'Diesel' },
  { value: 'electrique', label: 'Électrique' },
  { value: 'hybride', label: 'Hybride' },
  { value: 'gpl', label: 'GPL' },
] as const;

const EMPTY_FORM = {
  licensePlate: '',
  make: '',
  model: '',
  year: new Date().getFullYear(),
  color: '',
  photoUrl: '',
  currentMileage: 0,
  fuelType: '',
  parkingZone: '',
  deliveryPointName: '',
  deliveryPostalCode: '',
  pickupInstructions: '',
  returnInstructions: '',
  carekeeperUserId: '',
};

export default function VehicleFormPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [form, setForm] = useState(EMPTY_FORM);
  const [healthScore, setHealthScore] = useState(100);

  const { data: vehicle, isLoading } = useQuery({
    queryKey: ['vehicle', id],
    queryFn: () => vehiclesApi.get(id!),
    enabled: isEdit,
  });

  const { data: carkeepers = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ['users', 'carkeeper'],
    queryFn: () => api.get<{ users: Array<{ id: string; name: string }> }>('/users', { params: { role: 'carkeeper' } }).then(r => r.data.users),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (vehicle) {
      setForm({
        licensePlate: vehicle.licensePlate,
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year,
        color: vehicle.color ?? '',
        photoUrl: vehicle.photoUrl ?? '',
        currentMileage: vehicle.currentMileage,
        fuelType: (vehicle as { fuelType?: string | null }).fuelType ?? '',
        parkingZone: vehicle.parkingZone ?? '',
        deliveryPointName: (vehicle as { deliveryPointName?: string | null }).deliveryPointName ?? '',
        deliveryPostalCode: (vehicle as { deliveryPostalCode?: string | null }).deliveryPostalCode ?? '',
        pickupInstructions: vehicle.pickupInstructions ?? '',
        returnInstructions: vehicle.returnInstructions ?? '',
        carekeeperUserId: vehicle.carekeeperUserId ?? '',
      });
      setHealthScore(vehicle.healthScore);
    }
  }, [vehicle]);

  const createMutation = useMutation({
    mutationFn: (data: typeof EMPTY_FORM) => vehiclesApi.create({
      ...data,
      year: Number(data.year),
      currentMileage: Number(data.currentMileage),
      color: data.color || null,
      photoUrl: data.photoUrl || null,
      fuelType: (data.fuelType as never) || null,
      parkingZone: data.parkingZone || null,
      deliveryPointName: data.deliveryPointName || null,
      deliveryPostalCode: data.deliveryPostalCode || null,
      pickupInstructions: data.pickupInstructions || null,
      returnInstructions: data.returnInstructions || null,
      carekeeperUserId: data.carekeeperUserId || null,
    }),
    onSuccess: (v) => {
      void qc.invalidateQueries({ queryKey: ['vehicles'] });
      navigate(`/vehicles/${v.id}`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: typeof EMPTY_FORM & { healthScore: number }) =>
      vehiclesApi.update(id!, {
        ...data,
        year: Number(data.year),
        currentMileage: Number(data.currentMileage),
        color: data.color || null,
        photoUrl: data.photoUrl || null,
        fuelType: (data.fuelType as never) || null,
        parkingZone: data.parkingZone || null,
        deliveryPointName: data.deliveryPointName || null,
        deliveryPostalCode: data.deliveryPostalCode || null,
        pickupInstructions: data.pickupInstructions || null,
        returnInstructions: data.returnInstructions || null,
        carekeeperUserId: data.carekeeperUserId || null,
        healthScore: Number(data.healthScore),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['vehicles'] });
      void qc.invalidateQueries({ queryKey: ['vehicle', id] });
      navigate(`/vehicles/${id}`);
    },
  });

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (isEdit) updateMutation.mutate({ ...form, healthScore });
    else createMutation.mutate(form);
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  if (isEdit && isLoading) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" style={{ borderColor: '#01696e', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 max-w-xl">
      {/* Breadcrumb */}
      <div className="mb-6 flex items-center gap-2 text-sm">
        <Link to="/vehicles" className="text-gray-400 hover:text-gray-600">Flotte</Link>
        <span className="text-gray-300">/</span>
        {isEdit && vehicle && (
          <>
            <Link to={`/vehicles/${id}`} className="text-gray-400 hover:text-gray-600">
              {vehicle.make} {vehicle.model}
            </Link>
            <span className="text-gray-300">/</span>
          </>
        )}
        <span className="font-medium text-gray-900">{isEdit ? 'Modifier' : 'Nouveau véhicule'}</span>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
          <h1 className="text-lg font-bold text-gray-900">{isEdit ? 'Modifier le véhicule' : 'Ajouter un véhicule'}</h1>

          <div className="flex items-center gap-3 rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4">
            <span className="text-2xl">📷</span>
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-700">Scanner une carte grise</p>
              <p className="text-xs text-gray-400">L'IA extrait automatiquement les informations du véhicule</p>
            </div>
            <DocumentScanner
              type="vehicle"
              label="Scanner la carte grise"
              onResult={(data) => {
                if (data.licensePlate) setForm(f => ({ ...f, licensePlate: data.licensePlate as string }));
                if (data.make) setForm(f => ({ ...f, make: data.make as string }));
                if (data.model) setForm(f => ({ ...f, model: data.model as string }));
                if (data.year) setForm(f => ({ ...f, year: data.year as number }));
                if (data.color) setForm(f => ({ ...f, color: data.color as string }));
                if (data.fuelType) setForm(f => ({ ...f, fuelType: data.fuelType as string }));
              }}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Marque *</label>
              <input required type="text" value={form.make} onChange={e => setForm(f => ({ ...f, make: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" placeholder="Renault" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Modèle *</label>
              <input required type="text" value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" placeholder="Clio" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Immatriculation *</label>
              <input required type="text" value={form.licensePlate} onChange={e => setForm(f => ({ ...f, licensePlate: e.target.value.toUpperCase() }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-sm uppercase outline-none focus:border-[#01696e]" placeholder="AB-123-CD" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Année *</label>
              <input required type="number" min="1990" max={new Date().getFullYear() + 1} value={form.year}
                onChange={e => setForm(f => ({ ...f, year: Number(e.target.value) }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Couleur</label>
              <input type="text" value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" placeholder="Blanc" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Carburant</label>
              <select value={form.fuelType} onChange={e => setForm(f => ({ ...f, fuelType: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]">
                {FUEL_TYPES.map(ft => <option key={ft.value} value={ft.value}>{ft.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Kilométrage actuel</label>
              <input type="number" min="0" value={form.currentMileage}
                onChange={e => setForm(f => ({ ...f, currentMileage: Number(e.target.value) }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Zone de stationnement</label>
            <input type="text" value={form.parkingZone} onChange={e => setForm(f => ({ ...f, parkingZone: e.target.value }))}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]"
              placeholder="ex: Paris 15e, Boulogne, Versailles..." />
            <p className="mt-0.5 text-xs text-gray-400">Permet de regrouper vos véhicules par secteur géographique</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Nom du point de livraison</label>
              <input type="text" value={form.deliveryPointName} onChange={e => setForm(f => ({ ...f, deliveryPointName: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]"
                placeholder="ex: Parking Mignet" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Code postal</label>
              <input type="text" value={form.deliveryPostalCode} onChange={e => setForm(f => ({ ...f, deliveryPostalCode: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]"
                placeholder="ex: 75015" maxLength={10} />
            </div>
          </div>

          {carkeepers.length > 0 && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Car Keeper</label>
              <select
                value={form.carekeeperUserId}
                onChange={e => setForm(f => ({ ...f, carekeeperUserId: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]"
              >
                <option value="">— Aucun —</option>
                {carkeepers.map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Instructions de départ</label>
            <textarea rows={5} value={form.pickupInstructions} onChange={e => setForm(f => ({ ...f, pickupInstructions: e.target.value }))}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e] resize-y"
              placeholder="Adresse exacte, code portail, localisation boîte à clé, consignes particulières..." />
            <p className="mt-0.5 text-xs text-gray-400">Ces instructions sont transmises au locataire à la prise en charge du véhicule</p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Instructions de retour</label>
            <textarea rows={5} value={form.returnInstructions} onChange={e => setForm(f => ({ ...f, returnInstructions: e.target.value }))}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e] resize-y"
              placeholder="Où se garer, où déposer les clés, niveau carburant à respecter, consignes de nettoyage..." />
            <p className="mt-0.5 text-xs text-gray-400">Ces instructions sont transmises au locataire lors de la restitution du véhicule</p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">URL de la photo</label>
            <input type="url" value={form.photoUrl} onChange={e => setForm(f => ({ ...f, photoUrl: e.target.value }))}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#01696e]" placeholder="https://..." />
          </div>

          {form.photoUrl && (
            <img src={form.photoUrl} alt="Aperçu" className="h-32 w-full rounded-lg object-cover border border-gray-200" />
          )}
        </div>

        {(createMutation.isError || updateMutation.isError) && (
          <p className="text-sm text-red-600">Erreur lors de l'enregistrement. Vérifiez les champs.</p>
        )}

        <div className="flex gap-2">
          <button type="submit" disabled={isPending}
            className="rounded-xl px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-60 transition"
            style={{ backgroundColor: '#01696e' }}>
            {isPending ? 'Enregistrement...' : isEdit ? 'Enregistrer les modifications' : 'Créer le véhicule'}
          </button>
          <Link to={isEdit ? `/vehicles/${id}` : '/vehicles'}
            className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
            Annuler
          </Link>
        </div>
      </form>
    </div>
  );
}
