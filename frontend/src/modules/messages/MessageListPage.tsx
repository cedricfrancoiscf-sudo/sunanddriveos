import React, { useMemo, useEffect, useState } from 'react';
import { trackEvent } from '../../utils/tracking';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format, formatDistanceToNow } from 'date-fns';
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
  isUnanswered: boolean;
}

const RENTAL_STATUS_OPTIONS = [
  { value: '', label: 'Tous les statuts' },
  { value: 'booked', label: 'Réservées' },
  { value: 'active', label: 'Actives' },
  { value: 'completed', label: 'Terminées' },
  { value: 'cancelled', label: 'Annulées' },
];

type MsgTab = 'traiter' | 'ia' | 'traites' | 'cloture' | 'tous';

export default function MessageListPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  useEffect(() => { void trackEvent('messages', 'view'); }, []);
  const rentalIdFilter = searchParams.get('rentalId') ?? '';

  const [activeTab, setActiveTab] = useState<MsgTab>('tous');
  const [vehicleId, setVehicleId] = useState('');
  const [rentalStatus, setRentalStatus] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [expandedConversation, setExpandedConversation] = useState<string | null>(null);

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
    queryKey: ['messages', rentalIdFilter, vehicleId, rentalStatus, startDate, endDate, sortOrder],
    queryFn: () =>
      messagesApi.list({
        ...(rentalIdFilter ? { rentalId: rentalIdFilter } : {}),
        ...(vehicleId ? { vehicleId } : {}),
        ...(rentalStatus ? { rentalStatus } : {}),
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
        sortOrder,
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
          isUnanswered: false,
        });
      } else {
        existing.messageCount++;
        if (new Date(msg.createdAt) > new Date(existing.lastMessage.createdAt)) {
          existing.lastMessage = msg;
        }
        if (msg.status === 'pending_approval') existing.hasPending = true;
      }
    }

    const delay = summary?.unansweredDelayMs ?? 30 * 60_000;
    for (const conv of map.values()) {
      const last = conv.lastMessage;
      // Fil non répondu : inbound sans outbound sent/approved après lui, non clôturé, et délai dépassé
      conv.isUnanswered =
        !last.isThreadAnswered &&
        last.lastInboundAt != null &&
        !last.threadDismissedAt &&
        Date.now() - new Date(last.lastInboundAt).getTime() > delay;
    }

    // L'ordre vient du backend (groupBy _max createdAt desc)
    return Array.from(map.values());
  }, [messages]);

  const traiterCount = conversations.filter(c => c.isUnanswered).length;
  const iaCount = conversations.filter(c => c.hasPending).length;
  const clotureCount = conversations.filter(c => Boolean(c.lastMessage.threadDismissedAt)).length;

  const filteredConversations = useMemo<Conversation[]>(() => {
    switch (activeTab) {
      case 'traiter': return conversations.filter(c => c.isUnanswered && !c.lastMessage.threadDismissedAt);
      case 'ia': return conversations.filter(c => c.hasPending && !c.lastMessage.threadDismissedAt);
      case 'traites': return conversations.filter(c => !c.isUnanswered && !c.hasPending && !c.lastMessage.threadDismissedAt);
      case 'cloture': return conversations.filter(c => Boolean(c.lastMessage.threadDismissedAt));
      default: return conversations;
    }
  }, [conversations, activeTab]);

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

      {/* Onglets */}
      <div className="mb-4 flex border-b border-gray-200">
        {([
          { key: 'traiter' as MsgTab, label: 'À traiter', count: traiterCount, accent: true },
          { key: 'ia' as MsgTab, label: 'En attente IA', count: iaCount, accent: false },
          { key: 'traites' as MsgTab, label: 'Traités', count: null, accent: false },
          { key: 'cloture' as MsgTab, label: 'Clôturé', count: clotureCount || null, accent: false },
          { key: 'tous' as MsgTab, label: 'Tous', count: conversations.length, accent: false },
        ]).map(tab => (
          <button key={tab.key} type="button" onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.key
                ? 'border-[#01696e] text-[#01696e]'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {tab.label}
            {tab.count != null && tab.count > 0 && (
              <span className={`rounded-full px-1.5 py-0.5 text-xs font-semibold ${
                tab.accent ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'
              }`}>{tab.count}</span>
            )}
          </button>
        ))}
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

        <button
          type="button"
          onClick={() => setSortOrder(o => o === 'desc' ? 'asc' : 'desc')}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          title={sortOrder === 'desc' ? 'Tri : plus récent en premier' : 'Tri : plus ancien en premier'}
        >
          {sortOrder === 'desc' ? '↓ Plus récent' : '↑ Plus ancien'}
        </button>

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
      ) : filteredConversations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="font-medium text-gray-500">Aucune conversation</p>
          <p className="mt-1 text-sm text-gray-400">
            {activeTab === 'tous'
              ? 'Les messages apparaissent quand les locataires vous contactent via Getaround.'
              : 'Aucune conversation dans cet onglet.'}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          {filteredConversations.map((conv, idx) => {
            const isExpanded = expandedConversation === conv.rentalId;
            const threadMessages = messages
              .filter(m => m.rentalId === conv.rentalId)
              .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
            return (
              <div key={conv.rentalId} className={idx > 0 ? 'border-t border-gray-100' : ''}>
                {/* En-tête conversation cliquable */}
                <button
                  type="button"
                  data-rental-id={conv.rentalId}
                  onClick={() => setExpandedConversation(isExpanded ? null : conv.rentalId)}
                  className="w-full flex items-start gap-3 px-4 py-4 text-left hover:bg-gray-50 transition-colors"
                >
                  <div
                    className="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white mt-0.5"
                    style={{ backgroundColor: '#01696e' }}
                  >
                    {conv.driverName.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-gray-900 truncate">{conv.driverName}</span>
                      <span className="shrink-0 text-xs text-gray-400">
                        {formatDistanceToNow(new Date(conv.lastMessage.createdAt), { addSuffix: true, locale: fr })}
                      </span>
                    </div>
                    {(conv.isUnanswered || conv.hasPending || conv.lastMessage.threadDismissedAt) && (
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {conv.isUnanswered && (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Sans réponse</span>
                        )}
                        {conv.hasPending && (
                          <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">En attente</span>
                        )}
                        {conv.lastMessage.threadDismissedAt && (
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                            {conv.lastMessage.dismissedReason === 'auto_rental_ended' ? 'Clôturé auto' : 'Clôturé'}
                          </span>
                        )}
                      </div>
                    )}
                    <p className="mt-0.5 text-xs text-gray-400 truncate">{conv.vehicleLabel}</p>
                    {!isExpanded && (
                      <p className="mt-0.5 text-sm text-gray-600 line-clamp-1">
                        {conv.lastMessage.direction === 'inbound' ? '← ' : '→ '}
                        {conv.lastMessage.content.slice(0, 60)}{conv.lastMessage.content.length > 60 ? '…' : ''}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 flex items-center gap-2 pt-0.5">
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">{conv.messageCount}</span>
                    <svg className={`h-4 w-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </button>

                {/* Thread chat expansé */}
                {isExpanded && (
                  <div className="border-t border-gray-100 bg-gray-50 px-4 py-3 space-y-2">
                    {threadMessages.map(msg => (
                      <div key={msg.id} className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                          msg.direction === 'outbound'
                            ? msg.status === 'pending_approval'
                              ? 'bg-amber-100 text-amber-900 border border-amber-200'
                              : 'bg-[#01696e] text-white'
                            : 'bg-white text-gray-800 border border-gray-200'
                        }`}>
                          <p className="whitespace-pre-wrap">{msg.content}</p>
                          <p className={`mt-0.5 text-[10px] ${msg.direction === 'outbound' && msg.status !== 'pending_approval' ? 'text-white/70' : 'text-gray-400'}`}>
                            {format(new Date(msg.createdAt), 'dd/MM HH:mm', { locale: fr })}
                            {msg.status === 'pending_approval' && ' · En attente approbation'}
                          </p>
                        </div>
                      </div>
                    ))}
                    <div className="flex justify-end pt-1">
                      <button type="button"
                        onClick={() => navigate(`/messages/${conv.lastMessage.id}?rentalId=${conv.rentalId}`)}
                        className="text-xs text-[#01696e] hover:underline">
                        Ouvrir le détail →
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
