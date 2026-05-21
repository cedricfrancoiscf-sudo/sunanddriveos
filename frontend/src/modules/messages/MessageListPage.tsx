import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow, format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { messagesApi, type Message, type MessageStatus } from './messagesApi';

const STATUS_LABELS: Record<MessageStatus, string> = {
  pending_approval: 'En attente',
  approved: 'Approuvé',
  sent: 'Envoyé',
  cancelled: 'Annulé',
};

const STATUS_COLORS: Record<MessageStatus, string> = {
  pending_approval: 'bg-orange-100 text-orange-700',
  approved: 'bg-blue-100 text-blue-700',
  sent: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-400',
};

function AnalysisTags({ analysis }: { analysis: NonNullable<Message['aiAnalysis']> }): React.JSX.Element {
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {analysis.isCarSeatRequest && (
        <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
          Siège auto
        </span>
      )}
      {analysis.isIncidentReport && (
        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
          Incident
        </span>
      )}
      {analysis.isDissatisfaction && (
        <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
          Insatisfaction
        </span>
      )}
      {analysis.isUrgent && (
        <span className="rounded-full bg-red-200 px-2 py-0.5 text-xs font-bold text-red-800">
          ⚡ Urgent
        </span>
      )}
    </div>
  );
}

function MessageCard({ message }: { message: Message }): React.JSX.Element {
  const isInbound = message.direction === 'inbound';

  return (
    <Link
      to={`/messages/${message.id}`}
      className="block rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-[#01696e]/40 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* En-tête */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-gray-900">{message.rental.driverName}</span>
            <span className="text-xs text-gray-400">·</span>
            <span className="text-xs text-gray-500">
              {message.rental.vehicle.make} {message.rental.vehicle.model}
              <span className="ml-1 font-mono text-gray-400">({message.rental.vehicle.licensePlate})</span>
            </span>
          </div>

          {/* Contenu */}
          <div
            className={`mt-2 rounded-lg px-3 py-2 text-sm ${
              isInbound ? 'bg-gray-50 text-gray-700' : 'bg-[#01696e]/5 text-gray-700'
            }`}
          >
            <p className="line-clamp-2">{message.content}</p>
          </div>

          {/* Tags IA */}
          {message.aiAnalysis && <AnalysisTags analysis={message.aiAnalysis} />}

          {/* Suggestion IA dispo */}
          {message.aiSuggestion && message.status === 'pending_approval' && (
            <p className="mt-1.5 text-xs text-[#01696e]">
              ✦ Suggestion IA disponible
            </p>
          )}
        </div>

        {/* Méta droite */}
        <div className="flex shrink-0 flex-col items-end gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[message.status]}`}>
            {STATUS_LABELS[message.status]}
          </span>
          <span className="text-xs text-gray-400">
            {formatDistanceToNow(new Date(message.createdAt), { addSuffix: true, locale: fr })}
          </span>
          <span className={`text-xs font-medium ${isInbound ? 'text-gray-400' : 'text-[#01696e]'}`}>
            {isInbound ? '← Entrant' : '→ Sortant'}
          </span>
        </div>
      </div>
    </Link>
  );
}

const FILTER_OPTIONS = [
  { value: '', label: 'Tous' },
  { value: 'pending_approval', label: 'En attente' },
  { value: 'approved', label: 'Approuvés' },
  { value: 'sent', label: 'Envoyés' },
];

export default function MessageListPage(): React.JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const statusFilter = searchParams.get('status') ?? '';
  const rentalIdFilter = searchParams.get('rentalId') ?? '';

  const { data: summary } = useQuery({
    queryKey: ['inbox-summary'],
    queryFn: messagesApi.inboxSummary,
    refetchInterval: 30_000,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['messages', statusFilter, rentalIdFilter],
    queryFn: () =>
      messagesApi.list({
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(rentalIdFilter ? { rentalId: rentalIdFilter } : {}),
      }),
  });

  const messages = data?.messages ?? [];

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

      {/* Filtres par statut */}
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => {
              if (opt.value) setSearchParams({ status: opt.value });
              else setSearchParams({});
            }}
            className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition ${
              statusFilter === opt.value
                ? 'text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:border-[#01696e]/40'
            }`}
            style={statusFilter === opt.value ? { backgroundColor: '#01696e' } : undefined}
          >
            {opt.label}
            {opt.value === 'pending_approval' && summary?.pendingCount ? (
              <span className="ml-1.5 rounded-full bg-white/30 px-1.5 text-xs">
                {summary.pendingCount}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {/* Filtre location active */}
      {rentalIdFilter && (
        <div className="mb-3 flex items-center gap-2 rounded-lg bg-[#01696e]/5 px-3 py-2 text-sm">
          <span className="text-[#01696e]">Filtrés par location</span>
          <button
            type="button"
            onClick={() => setSearchParams({})}
            className="ml-auto text-xs text-gray-400 hover:text-gray-600"
          >
            Effacer le filtre ×
          </button>
        </div>
      )}

      {/* Liste */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <div
            className="h-8 w-8 animate-spin rounded-full border-4 border-t-transparent"
            style={{ borderColor: '#01696e', borderTopColor: 'transparent' }}
          />
        </div>
      ) : messages.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="font-medium text-gray-500">Aucun message</p>
          <p className="mt-1 text-sm text-gray-400">
            Les messages apparaissent quand les locataires vous contactent via Getaround.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {messages.map((m) => (
            <MessageCard key={m.id} message={m} />
          ))}
        </div>
      )}
    </div>
  );
}
