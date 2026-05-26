import React, { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { messagesApi, type Message } from './messagesApi';

interface Conversation {
  rentalId: string;
  driverName: string;
  vehicleLabel: string;
  lastMessage: Message;
  messageCount: number;
  hasPending: boolean;
}

export default function MessageListPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const rentalIdFilter = searchParams.get('rentalId') ?? '';

  const { data: summary } = useQuery({
    queryKey: ['inbox-summary'],
    queryFn: messagesApi.inboxSummary,
    refetchInterval: 30_000,
    staleTime: 25_000,
  });

  const { data, isLoading, isError } = useQuery({
    queryKey: ['messages', rentalIdFilter],
    queryFn: () =>
      messagesApi.list({
        ...(rentalIdFilter ? { rentalId: rentalIdFilter } : {}),
      }),
    staleTime: 30_000,
  });

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

    return Array.from(map.values()).sort(
      (a, b) => new Date(b.lastMessage.createdAt).getTime() - new Date(a.lastMessage.createdAt).getTime(),
    );
  }, [messages]);

  return (
    <div className="p-4 lg:p-6">
      {/* En-tête */}
      <div className="mb-6 flex items-center justify-between">
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
