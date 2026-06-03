import React, { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { api } from '../../utils/api';

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  relatedEntityType?: string;
  relatedEntityId?: string;
  targetUrl?: string | null;
  createdAt: string;
}

// Calcule l'URL cible depuis le type + relatedEntityId (fallback si targetUrl absent)
function resolveTargetUrl(n: Notification): string | null {
  if (n.targetUrl) return n.targetUrl;
  const id = n.relatedEntityId;
  const map: Record<string, string> = {
    car_seat_request:      `/rentals/${id}`,
    blacklisted_renter:    `/rentals/${id}`,
    fuel_insufficient:     `/rentals/${id}`,
    unresponsive_renter:   `/rentals/${id}`,
    evaluation_to_post:    `/rentals/${id}`,
    evaluation_blocked:    `/rentals/${id}`,
    maintenance_due:       `/maintenance/${id}`,
    technical_control_due: `/technical-controls/${id}`,
    sync_error:            '/settings#getaround',
    rating_drop:           `/vehicles/${id}`,
  };
  return map[n.type] ?? null;
}

const TYPE_ICONS: Record<string, string> = {
  ct_expiry: '🔧',
  maintenance_due: '⚙️',
  message_received: '💬',
  blocking_requested: '🚫',
  stock_rupture: '⚠️',
  document_expiry: '📄',
  default: '🔔',
};

export default function NotificationBell(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data: countData } = useQuery<{ count: number }>({
    queryKey: ['notifications-count'],
    queryFn: () => api.get('/notifications/unread-count').then(r => r.data as { count: number }),
    refetchInterval: 60_000,
  });

  const { data: notifData } = useQuery<{ notifications: Notification[] }>({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications?limit=20').then(r => r.data as { notifications: Notification[] }),
    enabled: open,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api.put(`/notifications/${id}/read`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      void qc.invalidateQueries({ queryKey: ['notifications-count'] });
    },
  });

  const markAllRead = useMutation({
    mutationFn: () => api.put('/notifications/read-all'),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      void qc.invalidateQueries({ queryKey: ['notifications-count'] });
    },
  });

  const [clearToast, setClearToast] = useState(false);

  const clearOld = useMutation({
    mutationFn: () => api.delete('/notifications/all'),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      void qc.invalidateQueries({ queryKey: ['notifications-count'] });
      setClearToast(true);
      setTimeout(() => setClearToast(false), 3000);
    },
  });

  // Fermer au clic extérieur
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const unread = countData?.count ?? 0;
  const notifications = notifData?.notifications ?? [];

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
        aria-label="Notifications"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-80 rounded-xl border border-gray-200 bg-white shadow-xl">
          {/* En-tête */}
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <span className="text-sm font-semibold text-gray-900">Notifications</span>
            <div className="flex items-center gap-3">
              {unread > 0 && (
                <button type="button" onClick={() => markAllRead.mutate()}
                  className="text-xs text-teal-600 hover:text-teal-700 font-medium">
                  Tout marquer lu
                </button>
              )}
              <button type="button"
                onClick={() => { if (confirm('Supprimer toutes les notifications ?')) clearOld.mutate(); }}
                disabled={clearOld.isPending}
                className="text-xs text-gray-400 hover:text-red-500 disabled:opacity-40 transition-colors"
                title="Supprimer toutes les notifications">
                {clearOld.isPending ? 'Suppression...' : 'Tout effacer'}
              </button>
            </div>
          </div>

          {/* Toast confirmation */}
          {clearToast && (
            <div className="border-b border-green-100 bg-green-50 px-4 py-2 text-xs text-green-700 font-medium">
              ✓ Toutes les notifications ont été supprimées
            </div>
          )}

          {/* Liste */}
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-gray-400">
                Aucune notification
              </div>
            ) : (
              notifications.map(n => (
                <button
                  key={n.id}
                  type="button"
                  className={`w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0 ${
                    !n.isRead ? 'bg-teal-50/40' : ''
                  }`}
                  onClick={() => {
                    if (!n.isRead) markRead.mutate(n.id);
                    const url = resolveTargetUrl(n);
                    if (url) {
                      setOpen(false);
                      navigate(url);
                    }
                  }}
                >
                  <div className="flex items-start gap-3">
                    <span className="text-base mt-0.5 shrink-0">
                      {TYPE_ICONS[n.type] ?? TYPE_ICONS.default}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className={`text-sm font-medium truncate ${!n.isRead ? 'text-gray-900' : 'text-gray-600'}`}>
                          {n.title}
                        </p>
                        {!n.isRead && (
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-teal-500" />
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.body}</p>
                      <p className="text-xs text-gray-400 mt-1">
                        {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true, locale: fr })}
                      </p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
