import { api } from '../../utils/api';

export type MessageStatus = 'pending_approval' | 'approved' | 'sent' | 'cancelled';
export type MessageDirection = 'inbound' | 'outbound';
export type MessageOrigin = 'manual' | 'ai_approved' | 'sequence' | 'getaround_system' | 'inbound';
export type DismissedReason = 'manual' | 'auto_rental_ended';

export interface Message {
  id: string;
  getaroundId: string | null;
  rentalId: string;
  direction: MessageDirection;
  content: string;
  sentAt: string | null;
  aiAnalysis: {
    isCarSeatRequest: boolean;
    isIncidentReport: boolean;
    isDissatisfaction: boolean;
    isUrgent: boolean;
    intent: string;
    sentiment: 'positive' | 'neutral' | 'negative';
  } | null;
  aiSuggestion: string | null;
  status: MessageStatus;
  origin: MessageOrigin | null;
  approvedBy: { id: string; name: string } | null;
  approvedAt: string | null;
  cancelledAt: string | null;
  importedViaSync?: boolean;
  createdAt: string;
  // Computed by the backend (listMessages and getMessage) — never recompute client-side
  isThreadAnswered?: boolean;
  lastInboundAt?: string | null;
  threadDismissedAt?: string | null;
  dismissedReason?: DismissedReason | null;
  rental: {
    id: string;
    driverName: string;
    startAt: string;
    endAt: string;
    status: string;
    threadDismissedAt?: string | null;
    dismissedReason?: DismissedReason | null;
    vehicle: { id: string; make: string; model: string; licensePlate: string };
    messages?: Array<{
      id: string;
      direction: 'inbound' | 'outbound';
      content: string;
      sentAt: string | null;
      status: string;
      aiSuggestion: string | null;
      aiAnalysis?: unknown;
      createdAt: string;
      importedViaSync?: boolean;
      origin?: MessageOrigin | null;
    }>;
  };
}

export interface InboxSummary {
  pendingCount: number;
  unansweredRentals: number;
  unansweredDelayMs?: number;
}

export const messagesApi = {
  list: (params: { rentalId?: string; vehicleId?: string; rentalStatus?: string; startDate?: string; endDate?: string; direction?: string; sortOrder?: 'asc' | 'desc'; page?: number; limit?: number } = {}) =>
    api.get<{ messages: Message[]; total: number }>('/messages', { params }).then((r) => r.data),

  get: (id: string) =>
    api.get<{ message: Message }>(`/messages/${id}`).then((r) => r.data.message),

  create: (rentalId: string, content: string, aiSuggestion?: string) =>
    api.post<{ message: Message }>('/messages', { rentalId, content, aiSuggestion }).then((r) => r.data.message),

  approve: (id: string, content?: string) =>
    api.post<{ success: boolean; status?: string }>(`/messages/${id}/approve`, { content }).then((r) => r.data),

  markSent: (id: string, getaroundMessageId?: string) =>
    api.post<{ message: Message }>(`/messages/${id}/mark-sent`, { getaroundMessageId }).then((r) => r.data.message),

  cancel: (id: string) =>
    api.post<{ message: Message }>(`/messages/${id}/cancel`).then((r) => r.data.message),

  dismiss: (rentalId: string) =>
    api.post<{ success: boolean }>(`/messages/rental/${rentalId}/dismiss`).then((r) => r.data),

  undismiss: (rentalId: string) =>
    api.post<{ success: boolean }>(`/messages/rental/${rentalId}/undismiss`).then((r) => r.data),

  regenerate: (rentalId: string) =>
    api.post<{ success: boolean; message?: string }>(`/messages/rental/${rentalId}/regenerate`).then((r) => r.data),

  inboxSummary: () =>
    api.get<InboxSummary>('/messages/inbox-summary').then((r) => r.data),
};

export const aiApi = {
  analyze: (content: string, opts?: { messageId?: string; rentalId?: string; vehicleId?: string }) =>
    api.post<{ analysis: Message['aiAnalysis']; carSeatRequestId?: string }>('/ai/analyze', { content, ...opts }).then((r) => r.data),

  suggest: (rentalId: string, incomingContent: string, saveAsDraft = false) =>
    api
      .post<{ suggestion: string | null; messageId?: string }>('/ai/suggest', { rentalId, incomingContent, saveAsDraft })
      .then((r) => r.data),
};
