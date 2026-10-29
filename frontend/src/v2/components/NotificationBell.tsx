// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, X } from 'lucide-react';
import { api } from '../../lib/apiClient';
import { getSocket } from '../../lib/socket';
import { qk } from '../lib/query';
import { timeAgo } from '../lib/time';
import { useIsNarrowViewport } from '../lib/useMediaQuery';
import { useNotificationsQuery, type NotificationsData } from '../lib/queries';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Skeleton } from './ui/skeleton';
import NotificationIcon from './notifications/NotificationIcon';
import { targetFor } from './notifications/notificationTarget';
import type { Notification } from '../types/api';
import { useT } from '../i18n';
import { notificationText } from '../lib/notificationText';

/**
 * Notifications area: anchored in the header bar, **to the left of the search**.
 *
 * It used to live at the bottom right, and not only the bell: each notification received
 * raised a toast. Three surfaces competed for the same corner: the `Toaster` (very high z-index),
 * the upload widget (`fixed bottom-4 right-4`, several hundred pixels high
 * while a sequence is being sent) and this stream, so that a notification covered
 * the progress of a send, or vice versa, depending on the arrival order.
 *
 * Two rules now hold the location:
 *
 * 1. **Nothing covers anything.** What is permanently visible (the bell, and the preview
 *    of the last notification) lives INSIDE the header flow: it pushes, it does not
 *    overlap. The breadcrumb, on its left, absorbs the space taken (`flex-1`).
 * 2. **The detail unfolds.** The full list remains a panel that opens only on a
 *    click: a hover, an arrival or a navigation never opens it.
 *
 * The preview replaces the toast: it says the same thing, at the same moment, without hiding anything, and
 * it disappears on its own. It is hidden in a narrow window, where there would be no room left to read
 * the breadcrumb.
 */

/** Display duration of the preview of a notification that has just arrived. */
const PEEK_MS = 6000;

export default function NotificationBell() {
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const narrow = useIsNarrowViewport();
  const [open, setOpen] = useState(false);
  const [peek, setPeek] = useState<Notification | null>(null);
  const { data, isLoading } = useNotificationsQuery();
  const notifications = data?.notifications ?? [];
  const unread = data?.unread ?? 0;

  // Real time: the server emits `notification:new` in the user's room
  // (joined automatically at connection), so we prepend the cache and the preview (10.C5/10.E3).
  useEffect(() => {
    const socket = getSocket();
    const onNew = (n: Notification) => {
      qc.setQueryData<NotificationsData>(qk.notifications, (prev) =>
        prev && !prev.notifications.some((x) => x.id === n.id)
          ? { notifications: [n, ...prev.notifications].slice(0, 100), unread: prev.unread + 1 }
          : prev,
      );
      if (!qc.getQueryData(qk.notifications)) void qc.invalidateQueries({ queryKey: qk.notifications });
      setPeek(n);
    };
    socket.on('notification:new', onNew);
    return () => {
      socket.off('notification:new', onNew);
    };
  }, [qc]);

  // The preview clears itself. The timer is restarted at each new notification:
  // two close arrivals leave the second one time to be read.
  useEffect(() => {
    if (!peek) return;
    const timer = setTimeout(() => setPeek(null), PEEK_MS);
    return () => clearTimeout(timer);
  }, [peek]);

  const markRead = useMutation({
    mutationFn: (id: number) => api.patch(`/api/notifications/${id}/read`),
    onSuccess: (_d, id) =>
      qc.setQueryData<NotificationsData>(qk.notifications, (prev) => {
        if (!prev) return prev;
        const wasUnread = prev.notifications.some((x) => x.id === id && !x.isRead);
        return {
          notifications: prev.notifications.map((x) => (x.id === id ? { ...x, isRead: true } : x)),
          unread: wasUnread ? Math.max(0, prev.unread - 1) : prev.unread,
        };
      }),
  });

  const markAll = useMutation({
    mutationFn: () => api.post('/api/notifications/read-all'),
    onSuccess: () =>
      qc.setQueryData<NotificationsData>(qk.notifications, (prev) =>
        prev ? { notifications: prev.notifications.map((x) => ({ ...x, isRead: true })), unread: 0 } : prev,
      ),
  });

  const onItemClick = (n: Notification) => {
    if (!n.isRead) markRead.mutate(n.id);
    setOpen(false);
    setPeek((current) => (current?.id === n.id ? null : current));
    void targetFor(n).then((to) => {
      if (to) void navigate(to);
    });
  };

  return (
    <div className="flex min-w-0 shrink items-center gap-1">
      {peek && !narrow && (
        <div className="flex min-w-0 max-w-xs items-center gap-1 rounded-md border border-border bg-secondary/40 pl-2">
          <button
            onClick={() => onItemClick(peek)}
            title={t('notifications.latest')}
            className="flex min-w-0 items-center gap-1.5 py-1.5 text-left text-xs text-foreground"
          >
            <NotificationIcon type={peek.type} />
            <span className="truncate">{notificationText(t, peek)}</span>
          </button>
          <button
            onClick={() => setPeek(null)}
            title={t('common.close')}
            aria-label={t('common.close')}
            className="shrink-0 rounded p-1.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X size={12} />
          </button>
        </div>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            title={t('notifications.title')}
            aria-label={
              unread > 0 ? t('notifications.unreadAria', { count: unread }) : t('notifications.title')
            }
            className="relative flex shrink-0 items-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          >
            <Bell size={18} />
            {unread > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent2 px-1 text-2xs font-semibold text-accent2-foreground">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-96 p-0">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm font-semibold">{t('notifications.title')}</span>
            <button
              onClick={() => markAll.mutate()}
              disabled={unread === 0 || markAll.isPending}
              className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              <CheckCheck size={14} /> {t('notif.markAllRead')}
            </button>
          </div>
          <div className="custom-scrollbar max-h-96 overflow-y-auto py-1">
            {isLoading ? (
              <div className="space-y-2 p-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : notifications.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                {t('notifications.empty')}
              </p>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => onItemClick(n)}
                  className={`flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-secondary/60 ${
                    n.isRead ? 'opacity-60' : ''
                  }`}
                >
                  <NotificationIcon type={n.type} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">{notificationText(t, n)}</span>
                    <span className="block text-xs text-muted-foreground">{timeAgo(n.createdAt)}</span>
                  </span>
                  {!n.isRead && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent2" />}
                </button>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
