import React, { useMemo, useEffect, useState } from 'react';
import { trackEvent } from '../../utils/tracking';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { api } from '../../utils/api';
import { messagesApi, type Message } from './messagesApi';

interface Conversation {
  rentalId: string;
  driverName: string;
  vehicleLabel: string;
  lastMessage: Message;
  messageCount: number;
  hasPending: boolean;
}

const RENTAL_STATUS_OPTIONS = [
  { value: '', label: 'Tous les statuts' },
  { value: 'booked', label: 'Réservées' },
  { value: 'active', label: 'Actives' },
  { value: 'completed', label: 'Terminées' },
  { value: 'cancelled', label: 'Annulées' },
];

export default function MessageListPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  useEffect(() => { void trackEvent('messages', 'view'); }, []);
  const rentalIdFilter = searchParams.get('rentalId') ?? '';

  const [vehicleId, setVehicleId] = useState('');
  const [rentalStatus, setRentalStatus] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const { data: vehiclesData } = useQuery({
    queryKey: ['vehicles-list'],
    queryFn: () => api.get<{ vehicles: Array<{ id: string; make: string; model: string; licensePlate: string }> }>('/vehicles').then(r => r.data.vehicles),
    staleTime: 5 * 60_000,
  });

  const { data: summary } = useQuery({
    queryKey: ['inbox-summary'],
    queryFn: messagesApi.inboxSummary,
    refetchInterval: 30_000,
    staleTime: 25_000,
  });

  const { data, isLoading, isError } = useQuery({
    queryKey: ['messages', rentalIdFilter, vehicleId, rentalStatus, startDate, endDate],
    queryFn: () =>
      messagesApi.list({
        ...(rentalIdFilter ? { rentalId: rentalIdFilter } : {}),
        ...(vehicleId ? { vehicleId } : {}),
        ...(rentalStatus ? { rentalStatus } : {}),
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
        limit: 200,
      }),
    staleTime: 30_000,
  });

  function resetFilters(): void {
    setVehicleId('');
    setRentalStatus('');
    setStartDate('');
    setEndDate('');
  }

  const hasActiveFilters = Boolean(vehicleId || rentalStatus || startDate || endDate);

  const messages = data?.messages ?? [];

  const conversations = useMemo<Conversation[]>(() => {
    const map = new Map<string, Conversation>();

    for (const msg of messages) {
      const rid = msg.rentalId ?? '';
      if (!rid) continue;

      const existing = map.get(rid);
      if (!existing) {
        map.set(rid, {
          rentalId: rid,
          driverName: msg.rental.driverName,
          vehicleLabel: `${msg.rental.vehicle.make} ${msg.rental.vehicle.model} (${msg.rental.vehicle.licensePlate})`,
          lastMessage: msg,
          messageCount: 1,
          hasPending: msg.status === 'pending_approval',
        });
      } else {
        existing.messageCount++;
        if (new Date(msg.createdAt) > new Date(existing.lastMessage.createdAt)) {
          existing.lastMessage = msg;
        }
        if (msg.status === 'pending_approval') existing.hasPending = true;
      }
    }

    // L'ordre vient du backend (groupBy _max createdAt desc)
    return Array.from(map.values());
  }, [messages]);

  return (
    <div className="p-4 lg:p-6">
      {/* En-tête */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Messages</h1>
          {summary && (
            <div className="mt-1 flex items-center gap-3 text-sm">
              {summary.pendingCount > 0 && (
                <span className="font-medium text-orange-600">
                  {summary.pendingCount} en attente d'approbation
                </span>
              )}
              {summary.unansweredRentals > 0 && (
                <span className="text-gray-400">
                  {summary.unansweredRentals} location{summary.unansweredRentals > 1 ? 's' : ''} sans réponse
                </span>
              )}
              {summary.pendingCount === 0 && summary.unansweredRentals === 0 && (
                <span className="text-green-600">Tout est traité</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Barre de filtres */}
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <select
          value={vehicleId}
          onChange={e => setVehicleId(e.target.value)}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 outline-none focus:border-[#01696e]"
        >
          <option value="">Tous les véhicules</option>
          {(vehiclesData ?? []).map(v => (
            <option key={v.id} value={v.id}>{v.make} {v.model} — {v.licensePlate}</option>
          ))}
        </select>

        <select
          value={rentalStatus}
          onChange={e => setRentalStatus(e.target.value)}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 outline-none focus:border-[#01696e]"
        >
          {RENTAL_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        <div className="flex items-center gap-1.5">
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700 outline-none focus:border-[#01696e]" />
          <span className="text-xs text-gray-400">→</span>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700 outline-none focus:border-[#01696e]" />
        </div>

        {hasActiveFilters && (
          <button type="button" onClick={resetFilters}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50 transition-colors">
            Réinitialiser
          </button>
        )}
      </div>

      {/* Liste conversations */}
      {isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Impossible de charger les messages.
        </div>
      )}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <div
            className="h-8 w-8 animate-spin rounded-full border-4 border-t-transparent"
            style={{ borderColor: '#01696e', borderTopColor: 'transparent' }}
          />
        </div>
      ) : conversations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="font-medium text-gray-500">Aucune conversation</p>
          <p className="mt-1 text-sm text-gray-400">
            Les messages apparaissent quand les locataires vous contactent via Getaround.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          {conversations.map((conv, idx) => (
            <button
              key={conv.rentalId}
              type="button"
              onClick={() => navigate(`/messages/${conv.lastMessage.id}?rentalId=${conv.rentalId}`)}
              className={`w-full flex items-center gap-4 px-4 py-4 text-left hover:bg-gray-50 transition-colors ${idx > 0 ? 'border-t border-gray-100' : ''}`}
            >
              {/* Avatar initiale conducteur */}
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                style={{ backgroundColor: '#01696e' }}
              >
                {conv.driverName.charAt(0).toUpperCase()}
              </div>

              {/* Contenu */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-semibold text-gray-900 truncate">{conv.driverName}</span>
                    {conv.hasPending && (
                      <span className="shrink-0 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
                        En attente
                      </span>
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-gray-400">
                    {formatDistanceToNow(new Date(conv.lastMessage.createdAt), { addSuffix: true, locale: fr })}
                  </span>
                </div>
                <p className="text-xs text-gray-400 truncate">{conv.vehicleLabel}</p>
                <p className="mt-1 text-sm text-gray-600 line-clamp-1">
                  {conv.lastMessage.direction === 'inbound' ? '← ' : '→ '}
                  {conv.lastMessage.content.slice(0, 60)}{conv.lastMessage.content.length > 60 ? '…' : ''}
                </p>
              </div>

              {/* Compteur messages */}
              <div className="shrink-0 text-right">
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                  {conv.messageCount}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
