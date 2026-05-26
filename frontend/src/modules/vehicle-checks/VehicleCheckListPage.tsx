import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { api } from '../../utils/api';

interface VehicleCheck {
  id: string;
  checkedAt: string;
  overallResult: 'pass' | 'advisory' | 'fail';
  status: string;
  vehicle: { id: string; make: string; model: string; licensePlate: string };
  checkedBy: { id: string; name: string };
}

const RESULT_LABELS = { pass: 'Favorable', advisory: 'Défavorable mineur', fail: 'Défavorable majeur' };
const RESULT_COLORS = { pass: 'bg-green-100 text-green-700', advisory: 'bg-yellow-100 text-yellow-700', fail: 'bg-red-100 text-red-700' };

export default function VehicleCheckListPage(): React.JSX.Element {
  const { data: checks = [], isLoading } = useQuery({
    queryKey: ['vehicle-checks'],
    queryFn: () => api.get<{ checks: VehicleCheck[] }>('/vehicle-checks').then(r => r.data.checks),
    staleTime: 2 * 60_000,
  });

  return (
    <div className="p-4 lg:p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Fiches contrôle</h1>
          <p className="text-sm text-gray-500">{checks.length} fiche{checks.length !== 1 ? 's' : ''}</p>
        </div>
        <Link to="/vehicle-checks/new"
          className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white" style={{ backgroundColor: '#01696e' }}>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Nouvelle fiche
        </Link>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" style={{ borderColor: '#01696e', borderTopColor: 'transparent' }} />
        </div>
      ) : checks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="font-medium text-gray-500">Aucune fiche contrôle</p>
          <Link to="/vehicle-checks/new" className="mt-2 text-sm text-[#01696e] hover:underline">Créer la première fiche →</Link>
        </div>
      ) : (
        <div className="space-y-2">
          {checks.map(c => (
            <Link key={c.id} to={`/vehicle-checks/${c.id}`}
              className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm transition hover:border-[#01696e]/40 hover:shadow-md">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-gray-900">{c.vehicle.make} {c.vehicle.model}</span>
                  <span className="font-mono text-xs text-gray-400">{c.vehicle.licensePlate}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${RESULT_COLORS[c.overallResult]}`}>
                    {RESULT_LABELS[c.overallResult]}
                  </span>
                </div>
                <div className="mt-0.5 flex gap-3 text-xs text-gray-400">
                  <span>{format(new Date(c.checkedAt), 'dd/MM/yyyy HH:mm', { locale: fr })}</span>
                  <span>par {c.checkedBy.name}</span>
                </div>
              </div>
              <svg className="h-5 w-5 shrink-0 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
