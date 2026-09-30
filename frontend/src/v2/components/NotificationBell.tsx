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
 * Espace des notifications — ancré dans la barre d'en-tête, **à gauche de la recherche**.
 *
 * Il vivait en bas à droite, et pas seulement la cloche : chaque notification reçue y
 * levait un toast. Trois surfaces s'y disputaient le même coin — le `Toaster` (z-index très
 * élevé), le widget d'upload (`fixed bottom-4 right-4`, plusieurs centaines de pixels de
 * haut pendant l'envoi d'une sequence) et ce flux — de sorte qu'une notification recouvrait
 * l'avancement d'un envoi, ou l'inverse, au hasard de l'ordre d'arrivée.
 *
 * Deux règles tiennent désormais l'emplacement :
 *
 * 1. **Rien ne recouvre rien.** Ce qui est visible en permanence — la cloche, et l'aperçu
 *    de la dernière notification — vit DANS le flux de l'en-tête : il pousse, il ne
 *    superpose pas. Le fil d'Ariane, à sa gauche, absorbe la place prise (`flex-1`).
 * 2. **Le détail se déplie.** La liste complète reste un panneau qui ne s'ouvre que sur un
 *    clic — un survol, une arrivée, une navigation ne l'ouvrent jamais.
 *
 * L'aperçu remplace le toast : il dit la même chose, au même moment, sans rien masquer, et
 * il disparaît seul. Il est masqué en fenêtre étroite, où il ne resterait pas de quoi lire
 * le fil d'Ariane.
 */

/** Durée d'affichage de l'aperçu d'une notification qui vient d'arriver. */
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

  // Temps réel : le serveur émet `notification:new` dans la room de l'utilisateur
  // (jointe automatiquement à la connexion) → on préfixe le cache + aperçu (10.C5/10.E3).
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

  // L'aperçu s'efface seul. Le minuteur est relancé à chaque nouvelle notification :
  // deux arrivées rapprochées laissent la seconde le temps d'être lue.
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
