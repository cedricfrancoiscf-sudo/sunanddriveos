import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, differenceInDays } from 'date-fns';
import { fr } from 'date-fns/locale';
import { messagesApi, type Message } from './messagesApi';

function Bubble({ msg, isLast }: { msg: { direction: string; content: string; sentAt: string | null; status: string; aiSuggestion: string | null; createdAt: string }; isLast: boolean }): React.JSX.Element {
  const isInbound = msg.direction === 'inbound';

  return (
    <div className={`flex ${isInbound ? 'justify-start' : 'justify-end'}`}>
      <div className={`max-w-[80%] ${isInbound ? '' : 'items-end flex flex-col'}`}>
        <div
          className={`rounded-2xl px-4 py-3 text-sm ${
            isInbound
              ? 'rounded-tl-sm bg-gray-100 text-gray-800'
              : 'rounded-tr-sm text-white'
          }`}
          style={!isInbound ? { backgroundColor: '#01696e' } : undefined}
        >
          {msg.content}
        </div>
        <p className="mt-1 px-1 text-xs text-gray-400 flex items-center gap-1">
          {msg.sentAt
            ? format(new Date(msg.sentAt), 'dd/MM HH:mm', { locale: fr })
            : format(new Date(msg.createdAt), 'dd/MM HH:mm', { locale: fr })}
          {!isInbound && (
            msg.status === 'sent' ? (
              <span title="Envoyé sur Getaround" style={{ fontSize: 10 }}>✅</span>
            ) : msg.status === 'pending_approval' ? (
              <span title="En attente" style={{ fontSize: 10 }}>🕐</span>
            ) : null
          )}
        </p>
      </div>
    </div>
  );
}

function AnalysisCard({ analysis }: { analysis: NonNullable<Message['aiAnalysis']> }): React.JSX.Element {
  const flags = [
    analysis.isCarSeatRequest && { label: 'Siège auto demandé', color: 'bg-purple-100 text-purple-700' },
    analysis.isIncidentReport && { label: 'Incident signalé', color: 'bg-red-100 text-red-700' },
    analysis.isDissatisfaction && { label: 'Insatisfaction', color: 'bg-orange-100 text-orange-700' },
    analysis.isUrgent && { label: '⚡ Urgent', color: 'bg-red-200 text-red-800 font-bold' },
  ].filter(Boolean) as { label: string; color: string }[];

  return (
    <div className="rounded-xl border border-[#01696e]/20 bg-[#01696e]/5 p-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#01696e]">Analyse IA</p>
      <p className="mb-2 text-sm text-gray-700">{analysis.intent}</p>
      {flags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {flags.map((f) => (
            <span key={f.label} className={`rounded-full px-2 py-0.5 text-xs ${f.color}`}>
              {f.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MessageDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [replyContent, setReplyContent] = useState('');
  const { data: message, isLoading } = useQuery({

    queryKey: ['message', id],
    queryFn: () => messagesApi.get(id!),
    enabled: Boolean(id),
    staleTime: 30_000,
  });

  // Brouillon IA : outbound pending_approval avec aiSuggestion dans le thread
  const aiDraft = (message?.rental.messages ?? []).find(
    m => m.direction === 'outbound' && m.status === 'pending_approval' && m.aiSuggestion != null,
  );

  useEffect(() => {
    if (aiDraft && !replyContent) setReplyContent(aiDraft.content);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiDraft?.id]);

  const approveMutation = useMutation({
    mutationFn: ({ msgId, content }: { msgId: string; content?: string }) =>
      messagesApi.approve(msgId, content || undefined),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['message', id] });
      void qc.invalidateQueries({ queryKey: ['messages'] });
      void qc.invalidateQueries({ queryKey: ['inbox-summary'] });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => messagesApi.cancel(id!),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['message', id] }); },
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <div
          className="h-8 w-8 animate-spin rounded-full border-4 border-t-transparent"
          style={{ borderColor: '#01696e', borderTopColor: 'transparent' }}
        />
      </div>
    );
  }

  if (!message) {
    return (
      <div className="p-6">
        <p className="text-red-600">Message introuvable.</p>
        <Link to="/messages" className="mt-2 inline-block text-sm text-[#01696e]">← Retour</Link>
      </div>
    );
  }

  const thread = message.rental.messages ?? [];
  const isPending = message.status === 'pending_approval';
  const isApproved = message.status === 'approved';
  const aiSuggestDisabled =
    message.rental.status === 'completed' &&
    differenceInDays(new Date(), new Date(message.rental.endAt)) > 7;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-gray-200 bg-white px-4 py-3 lg:px-6">
        <div className="flex items-center gap-3">
          <Link to="/messages" className="text-gray-400 hover:text-gray-600">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className="flex-1">
            <p className="font-semibold text-gray-900">{message.rental.driverName}</p>
            <p className="text-xs text-gray-500">
              {message.rental.vehicle.make} {message.rental.vehicle.model} · {message.rental.vehicle.licensePlate} ·{' '}
              {format(new Date(message.rental.startAt), 'dd/MM', { locale: fr })} →{' '}
              {format(new Date(message.rental.endAt), 'dd/MM/yy', { locale: fr })}
            </p>
          </div>
          <Link
            to={`/rentals/${message.rentalId}`}
            className="text-xs text-[#01696e] hover:underline"
          >
            Voir la location →
          </Link>
        </div>
      </div>

      {/* Thread */}
      <div className="flex-1 overflow-y-auto px-4 py-4 lg:px-6">
        <div className="mx-auto max-w-2xl space-y-3">
          {thread.map((m, i) => (
            <Bubble key={m.id} msg={m} isLast={i === thread.length - 1} />
          ))}
        </div>
      </div>

      {/* Zone réponse / approbation */}
      <div className="shrink-0 border-t border-gray-200 bg-white p-4 lg:p-6">
        <div className="mx-auto max-w-2xl space-y-3">
          {/* Analyse IA du dernier message entrant */}
          {message.direction === 'inbound' && message.aiAnalysis && (
            <AnalysisCard analysis={message.aiAnalysis} />
          )}

          {/* Message en attente d'approbation — on affiche le contenu éditable */}
          {(isPending || isApproved) && (
            <>
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-xs font-medium text-gray-500">
                    {isPending ? 'Suggestion à approuver' : 'Message approuvé'}
                  </label>
                </div>
                <textarea
                  value={replyContent || message.content}
                  onChange={(e) => setReplyContent(e.target.value)}
                  rows={4}
                  readOnly={isApproved}
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none transition focus:border-[#01696e] focus:ring-2 focus:ring-[#01696e]/20 read-only:bg-gray-50 read-only:text-gray-500"
                />
              </div>

              <div className="flex gap-2">
                {isPending && (
                  <>
                    <button
                      type="button"
                      onClick={() => approveMutation.mutate({ msgId: id!, content: replyContent || message.content })}
                      disabled={approveMutation.isPending}
                      className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white transition disabled:opacity-60"
                      style={{ backgroundColor: '#01696e' }}
                    >
                      {approveMutation.isPending ? 'Approbation...' : 'Approuver'}
                    </button>
                    <button
                      type="button"
                      onClick={() => cancelMutation.mutate()}
                      disabled={cancelMutation.isPending}
                      className="rounded-xl border border-red-200 px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
                    >
                      Annuler
                    </button>
                  </>
                )}
                {isApproved && (
                  <p className="w-full text-center text-xs text-gray-400 py-2">En attente d'envoi sur Getaround</p>
                )}
              </div>
            </>
          )}

          {/* Réponse libre si le message est entrant et envoyé/aucun brouillon */}
          {message.direction === 'inbound' && message.status === 'sent' && (
            <div className="space-y-2">
              {aiDraft && (
                <div className="flex items-center gap-1.5 text-xs font-medium text-[#01696e]">
                  <span>✨</span>
                  <span>Brouillon IA — modifiable avant envoi</span>
                </div>
              )}
              <textarea
                value={replyContent}
                onChange={(e) => setReplyContent(e.target.value)}
                placeholder="Rédiger une réponse..."
                rows={3}
                className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-[#01696e] focus:ring-2 focus:ring-[#01696e]/20"
              />
              <div className="flex gap-2">
                {replyContent && (
                  <button
                    type="button"
                    onClick={() => {
                      if (aiDraft) {
                        approveMutation.mutate({ msgId: aiDraft.id, content: replyContent });
                        setReplyContent('');
                      } else {
                        const content = replyContent;
                        setReplyContent('');
                        void (async () => {
                          try {
                            const newMsg = await messagesApi.create(message.rentalId, content);
                            await messagesApi.approve(newMsg.id, content);
                            await qc.invalidateQueries({ queryKey: ['message', id] });
                            await qc.invalidateQueries({ queryKey: ['messages'] });
                            await qc.invalidateQueries({ queryKey: ['inbox-summary'] });
                          } catch (e) {
                            console.error('[Envoyer] Erreur:', e);
                          }
                        })();
                      }
                    }}
                    disabled={approveMutation.isPending}
                    className="flex-1 rounded-xl py-2 text-sm font-semibold text-white disabled:opacity-60"
                    style={{ backgroundColor: '#01696e' }}
                  >
                    Envoyer
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Message envoyé ou annulé — lecture seule */}
          {(message.status === 'sent' && message.direction === 'outbound') && (
            <p className="text-center text-xs text-gray-400">
              Message envoyé le {message.sentAt ? format(new Date(message.sentAt), 'dd/MM/yyyy à HH:mm', { locale: fr }) : '—'}
            </p>
          )}
          {message.status === 'cancelled' && (
            <p className="text-center text-xs text-gray-400">Message annulé</p>
          )}
        </div>
      </div>
    </div>
  );
}
