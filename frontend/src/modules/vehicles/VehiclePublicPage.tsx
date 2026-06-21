import React from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';

interface PublicVehicle {
  make: string;
  model: string;
  year: number;
  color: string | null;
  photoUrl: string | null;
  fuelType: string | null;
  deliveryZone: string | null;
  deliveryPostalCode: string | null;
  parkingZone: string | null;
  getaroundUrl: string | null;
}

const FUEL_LABELS: Record<string, string> = {
  essence: 'Essence', diesel: 'Diesel', electrique: 'Électrique',
  hybride: 'Hybride', gpl: 'GPL',
};

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api/v1';

export default function VehiclePublicPage(): React.JSX.Element {
  const { licensePlate } = useParams<{ licensePlate: string }>();

  const { data, isLoading, isError } = useQuery<PublicVehicle>({
    queryKey: ['public-vehicle', licensePlate],
    queryFn: () =>
      axios.get<PublicVehicle>(`${API_BASE.replace('/api/v1', '')}/public/vehicles/${licensePlate ?? ''}`).then(r => r.data),
    staleTime: 5 * 60_000,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" style={{ borderColor: '#01696e', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-xl font-semibold text-gray-700">Véhicule introuvable</p>
          <p className="mt-1 text-sm text-gray-400">Ce véhicule n'est pas disponible.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white shadow-lg overflow-hidden">
        {data.photoUrl && (
          <img src={data.photoUrl} alt={`${data.make} ${data.model}`}
            className="w-full h-56 object-cover" />
        )}
        <div className="p-6 space-y-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{data.make} {data.model}</h1>
            <p className="text-sm text-gray-500">{data.year}{data.color ? ` · ${data.color}` : ''}{data.fuelType ? ` · ${FUEL_LABELS[data.fuelType] ?? data.fuelType}` : ''}</p>
          </div>

          {(data.deliveryZone || data.parkingZone) && (
            <div className="rounded-xl bg-gray-50 p-4 space-y-1">
              {data.deliveryZone && (
                <p className="text-sm text-gray-700">
                  <span className="font-medium">Zone de livraison :</span> {data.deliveryZone}
                  {data.deliveryPostalCode ? ` (${data.deliveryPostalCode})` : ''}
                </p>
              )}
              {data.parkingZone && (
                <p className="text-sm text-gray-700">
                  <span className="font-medium">Stationnement :</span> {data.parkingZone}
                </p>
              )}
            </div>
          )}

          {data.getaroundUrl ? (
            <a href={data.getaroundUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full rounded-xl py-3 text-sm font-semibold text-white transition"
              style={{ backgroundColor: '#01696e' }}>
              Réserver sur Getaround
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          ) : (
            <p className="text-center text-sm text-gray-400">Véhicule non disponible à la réservation</p>
          )}
        </div>
        <div className="border-t border-gray-100 px-6 py-3 text-center">
          <p className="text-[11px] text-gray-400">Page publique générée par SunanddriveOS</p>
        </div>
      </div>
    </div>
  );
}
