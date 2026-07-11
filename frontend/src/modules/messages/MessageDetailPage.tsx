import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, differenceInDays } from 'date-fns';
import { fr } from 'date-fns/locale';
import { messagesApi, type Message } from './messagesApi';

function Bubble({ msg }: { msg: { direction: string; content: string; sentAt: string | null; status: string; aiSuggestion: string | null; createdAt: string } }): React.JSX.Element {
  const isInbound = msg.direction === 'inbound';

  return (
    <div className={`flex ${isInbound ? 'justify-start' : 'justify-end'}`}>
      <div className={`max-w-[80%] ${isInbound ? '' : 'items-end flex flex-col'}`}>
        <div
          className={`rounded-2xl px-4 py-3 text-sm ${
            isInbound
              ? 'rounded-tl-sm bg-gray-100 text-gray-800'
              : msg.status === 'cancelled'
              ? 'rounded-tr-sm bg-gray-200 text-gray-400 line-through'
              : 'rounded-tr-sm text-white'
          }`}
          style={!isInbound && msg.status !== 'cancelled' ? { backgroundColor: '#01696e' } : undefined}
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
            ) : msg.status === 'cancelled' ? (
              <span title="Annulé" className="text-gray-300 text-[10px]">annulé</span>
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
  const [manualMode, setManualMode] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const { data: message, isLoading } = useQuery({
    queryKey: ['message', id],
    queryFn: () => messagesApi.get(id!),
    enabled: Boolean(id),
    staleTime: 30_000,
  });

  const thread = message?.rental.messages ?? [];

  // Brouillon IA : outbound pending_approval dans le fil
  const activeDraft = thread.find(
    m => m.direction === 'outbound' && m.status === 'pending_approval' && m.aiSuggestion != null,
  );

  // Dernier message inbound du fil
  const lastInbound = [...thread].reverse().find(m => m.direction === 'inbound');

  // Calculé côté backend (getMessage) — même définition que listMessages/isThreadAnswered,
  // jamais réimplémenté ici pour éviter toute dérive entre le fil et la liste.
  const hasReplyAfterLastInbound = Boolean(message?.isThreadAnswered);

  // BLOC 3 — brouillon périmé : nouveau inbound arrivé depuis la génération du brouillon
  const isDraftStale =
    activeDraft != null &&
    lastInbound != null &&
    new Date(lastInbound.createdAt) > new Date(activeDraft.createdAt);

  // BLOC 1 — composer visible si : inbound sans réponse envoyée OU mode manuel forcé
  const showComposer = (!hasReplyAfterLastInbound && lastInbound != null && !activeDraft) || manualMode;

  const isThreadDismissed = Boolean(message?.rental.threadDismissedAt);

  // Pré-remplir le textarea avec le brouillon IA quand il arrive
  useEffect(() => {
    const suggestion = activeDraft?.content ?? message?.aiSuggestion;
    if (suggestion && !replyContent && !manualMode) setReplyContent(suggestion);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDraft?.id, message?.aiSuggestion]);

  const invalidateAll = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['message', id] }),
      qc.invalidateQueries({ queryKey: ['messages'] }),
      qc.invalidateQueries({ queryKey: ['inbox-summary'] }),
    ]);
  };

  const approveMutation = useMutation({
    mutationFn: ({ msgId, content }: { msgId: string; content?: string }) =>
      messagesApi.approve(msgId, content || undefined),
    onSuccess: () => { void invalidateAll(); setSendError(null); },
    onError: (err: Error) => setSendError(err.message),
  });

  // "Répondre autrement" — écarte le brouillon IA, ouvre le composer manuel
  const cancelDraftMutation = useMutation({
    mutationFn: (msgId: string) => messagesApi.cancel(msgId),
    onSuccess: () => {
      setManualMode(true);
      setReplyContent('');
      void qc.invalidateQueries({ queryKey: ['message', id] });
    },
  });

  // "Clôturer sans réponse"
  const dismissMutation = useMutation({
    mutationFn: () => messagesApi.dismiss(message!.rentalId),
    onSuccess: () => { void invalidateAll(); },
  });

  // Réouvrir un fil clôturé
  const undismissMutation = useMutation({
    mutationFn: () => messagesApi.undismiss(message!.rentalId),
    onSuccess: () => { void invalidateAll(); },
  });

  // BLOC 3 — régénérer un brouillon périmé
  const regenerateMutation = useMutation({
    mutationFn: () => messagesApi.regenerate(message!.rentalId),
    onSuccess: () => {
      setManualMode(false);
      void qc.invalidateQueries({ queryKey: ['message', id] });
    },
  });

  const aiSuggestDisabled =
    message?.rental.status === 'completed' &&
    differenceInDays(new Date(), new Date(message.rental.endAt)) > 7;

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
              {isThreadDismissed && (
                <span className="ml-2 inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">Clôturé</span>
              )}
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
          {thread.map((m) => (
            <Bubble key={m.id} msg={m} />
          ))}
        </div>
      </div>

      {/* Zone réponse */}
      <div className="shrink-0 border-t border-gray-200 bg-white p-4 lg:p-6">
        <div className="mx-auto max-w-2xl space-y-3">

          {/* Analyse IA du dernier message entrant */}
          {message.direction === 'inbound' && message.aiAnalysis && (
            <AnalysisCard analysis={message.aiAnalysis} />
          )}

          {sendError && (
            <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{sendError}</p>
          )}

          {/* Fil clôturé */}
          {isThreadDismissed && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-center">
              <p className="text-sm text-gray-500 mb-2">Ce fil a été clôturé sans réponse.</p>
              <button
                type="button"
                onClick={() => undismissMutation.mutate()}
                disabled={undismissMutation.isPending}
                className="text-sm text-[#01696e] hover:underline disabled:opacity-60"
              >
                Réouvrir le fil
              </button>
            </div>
          )}

          {/* Brouillon IA en attente d'approbation */}
          {!isThreadDismissed && activeDraft && !manualMode && (
            <>
              {/* BLOC 3 — bannière brouillon périmé */}
              {isDraftStale && (
                <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
                  <span className="text-amber-600">⚠️</span>
                  <span className="flex-1 text-amber-700">Le contexte a évolué depuis ce brouillon.</span>
                  <button
                    type="button"
                    onClick={() => regenerateMutation.mutate()}
                    disabled={regenerateMutation.isPending}
                    className="shrink-0 rounded-lg border border-amber-300 bg-white px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-60"
                  >
                    {regenerateMutation.isPending ? 'Régénération...' : 'Régénérer'}
                  </button>
                </div>
              )}

              <div data-testid="ai-draft-zone">
                <label className="mb-1 block text-xs font-medium text-gray-500">
                  Suggestion IA à approuver
                </label>
                <textarea
                  value={replyContent || activeDraft.content}
                  onChange={(e) => setReplyContent(e.target.value)}
                  placeholder="L'IA génère une suggestion..."
                  rows={4}
                  disabled={isDraftStale}
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none transition focus:border-[#01696e] focus:ring-2 focus:ring-[#01696e]/20 disabled:bg-gray-50 disabled:text-gray-400"
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => approveMutation.mutate({ msgId: activeDraft.id, content: replyContent || activeDraft.content })}
                  disabled={approveMutation.isPending || isDraftStale}
                  title={isDraftStale ? 'Régénérez le brouillon avant d\'approuver' : undefined}
                  className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white transition disabled:opacity-60"
                  style={{ backgroundColor: isDraftStale ? '#9ca3af' : '#01696e' }}
                >
                  {approveMutation.isPending ? 'Envoi...' : 'Approuver et envoyer'}
                </button>
                {/* BLOC 1 — "Répondre autrement" */}
                <button
                  type="button"
                  onClick={() => cancelDraftMutation.mutate(activeDraft.id)}
                  disabled={cancelDraftMutation.isPending}
                  className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-60"
                >
                  Répondre autrement
                </button>
                {/* BLOC 1 — "Clôturer sans réponse" */}
                <button
                  type="button"
                  onClick={() => dismissMutation.mutate()}
                  disabled={dismissMutation.isPending}
                  className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-400 hover:bg-gray-50 disabled:opacity-60"
                  title="Clôturer ce fil sans répondre"
                >
                  Clôturer
                </button>
              </div>
            </>
          )}

          {/* Composer manuel — visible après "Répondre autrement" ou quand pas de brouillon ni réponse */}
          {!isThreadDismissed && showComposer && !aiSuggestDisabled && (
            <div className="space-y-2">
              {activeDraft == null && (message.aiSuggestion) && !manualMode && (
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
                autoFocus={manualMode}
                className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-[#01696e] focus:ring-2 focus:ring-[#01696e]/20"
              />
              <div className="flex gap-2">
                {replyContent.trim() && (
                  <button
                    type="button"
                    onClick={() => {
                      const content = replyContent.trim();
                      setSendError(null);
                      setReplyContent('');
                      void (async () => {
                        try {
                          const newMsg = await messagesApi.create(message.rentalId, content);
                          await messagesApi.approve(newMsg.id, content);
                          await invalidateAll();
                          setManualMode(false);
                        } catch (e) {
                          setSendError(e instanceof Error ? e.message : 'Erreur envoi');
                        }
                      })();
                    }}
                    className="flex-1 rounded-xl py-2 text-sm font-semibold text-white disabled:opacity-60"
                    style={{ backgroundColor: '#01696e' }}
                  >
                    Envoyer
                  </button>
                )}
                {/* BLOC 1 — "Clôturer sans réponse" depuis le composer */}
                {!hasReplyAfterLastInbound && (
                  <button
                    type="button"
                    onClick={() => dismissMutation.mutate()}
                    disabled={dismissMutation.isPending}
                    className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-400 hover:bg-gray-50 disabled:opacity-60"
                    title="Clôturer ce fil sans répondre"
                  >
                    Clôturer
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Fil traité : dernier outbound envoyé */}
          {hasReplyAfterLastInbound && !activeDraft && !manualMode && (
            <p className="text-center text-xs text-gray-400">
              Réponse envoyée ✓
            </p>
          )}

        </div>
      </div>
    </div>
  );
}
