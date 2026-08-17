// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AtSign, Bell, CheckCheck, ListTodo, MessageSquare, Radio, Reply } from 'lucide-react';
import { api } from '../../lib/apiClient';
import { getSocket } from '../../lib/socket';
import { qk } from '../lib/query';
import { timeAgo } from '../lib/time';
import { useNotificationsQuery, type NotificationsData } from '../lib/queries';
import { itemPath } from '../pages/review/playlistNav';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Skeleton } from './ui/skeleton';
import type { Notification, PlaylistDetail } from '../types/api';
import { useT } from '../i18n';

/** Cible navigable d'une notification selon son type (référence = tâche ou média). */
function linkFor(n: Notification): string | null {
  if (n.type === 'TASK_ASSIGNED' && n.referenceId) return `/tasks/${n.referenceId}`;
  if (
    (n.type === 'REPLY' || n.type === 'COMMENT_ASSIGNED' || n.type === 'MENTION' || n.type === 'WATCH') &&
    n.referenceId
  )
    return `/review/${n.referenceId}`;
  if (n.projectId) return `/projects/${n.projectId}`;
  return null;
}

/**
 * Notification LIVE (review live sur une playlist, retours 33) : mène directement à la
 * session — premier média lisible de la playlist avec `?playlist=&live=1`. Repli : projet.
 */
async function liveLinkFor(n: Notification): Promise<string | null> {
  if (!n.referenceId) return n.projectId ? `/projects/${n.projectId}` : null;
  try {
    const { playlist } = await api.get<{ playlist: PlaylistDetail }>(`/api/playlists/${n.referenceId}`);
    const first = playlist.items.find((it) => it.media);
    const path = first ? itemPath(first, playlist.id) : null;
    if (path) return `${path}&live=1`;
  } catch {
    // Playlist supprimée ou inaccessible : repli sur la page projet.
  }
  return n.projectId ? `/projects/${n.projectId}` : null;
}

function IconFor({ type }: { type: Notification['type'] }) {
  const cls = 'mt-0.5 shrink-0 text-muted-foreground';
  if (type === 'TASK_ASSIGNED') return <ListTodo size={16} className={cls} />;
  if (type === 'REPLY') return <Reply size={16} className={cls} />;
  if (type === 'COMMENT_ASSIGNED') return <MessageSquare size={16} className={cls} />;
  if (type === 'MENTION') return <AtSign size={16} className={cls} />;
  if (type === 'LIVE') return <Radio size={16} className="mt-0.5 shrink-0 text-accent2" />;
  return <Bell size={16} className={cls} />;
}

export default function NotificationBell() {
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useNotificationsQuery();
  const notifications = data?.notifications ?? [];
  const unread = data?.unread ?? 0;

  // Temps réel : le serveur émet `notification:new` dans la room de l'utilisateur
  // (jointe automatiquement à la connexion) → on préfixe le cache + toast (10.C5/10.E3).
  useEffect(() => {
    const socket = getSocket();
    const onNew = (n: Notification) => {
      qc.setQueryData<NotificationsData>(qk.notifications, (prev) =>
        prev && !prev.notifications.some((x) => x.id === n.id)
          ? { notifications: [n, ...prev.notifications].slice(0, 100), unread: prev.unread + 1 }
          : prev,
      );
      if (!qc.getQueryData(qk.notifications)) void qc.invalidateQueries({ queryKey: qk.notifications });
      toast(n.content);
    };
    socket.on('notification:new', onNew);
    return () => {
      socket.off('notification:new', onNew);
    };
  }, [qc]);

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
    if (n.type === 'LIVE') {
      void liveLinkFor(n).then((to) => to && navigate(to));
      return;
    }
    const to = linkFor(n);
    if (to) void navigate(to);
  };

  return (
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
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">{t('notifications.empty')}</p>
          ) : (
            notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => onItemClick(n)}
                className={`flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-secondary/60 ${
                  n.isRead ? 'opacity-60' : ''
                }`}
              >
                <IconFor type={n.type} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground">{n.content}</span>
                  <span className="block text-xs text-muted-foreground">{timeAgo(n.createdAt)}</span>
                </span>
                {!n.isRead && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent2" />}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
