// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react';
import { api } from '../../lib/apiClient';
import { getSocket, emitActivity } from '../../lib/socket';
import type { UserStatus } from '../types/api';

export interface PresenceUser {
  id: number;
  email: string;
  displayName: string;
  initials: string;
  avatarUrl: string | null;
  status: UserStatus;
  lastSeenAt: string | null;
  online: boolean;
}

/**
 * Présence des utilisateurs : liste initiale via REST, mises à jour live via
 * Socket.io (event `presence:update`). Émet aussi un signal d'activité régulier.
 */
export function usePresence() {
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const [onlineIds, setOnlineIds] = useState<Set<number>>(new Set());

  const reload = () =>
    api
      .get<{ users: PresenceUser[] }>('/api/users/presence')
      .then((d) => {
        setUsers(d.users);
        setOnlineIds(new Set(d.users.filter((u) => u.online).map((u) => u.id)));
      })
      .catch(() => undefined);

  useEffect(() => {
    reload();
    const socket = getSocket();
    const onPresence = (data: { onlineUserIds: number[] }) => {
      setOnlineIds(new Set(data.onlineUserIds));
    };
    socket.on('presence:update', onPresence);

    // Signale l'activité immédiatement puis périodiquement
    emitActivity();
    const interval = setInterval(emitActivity, 60_000);
    const onActivity = () => emitActivity();
    window.addEventListener('click', onActivity);
    window.addEventListener('keydown', onActivity);

    return () => {
      socket.off('presence:update', onPresence);
      clearInterval(interval);
      window.removeEventListener('click', onActivity);
      window.removeEventListener('keydown', onActivity);
    };
  }, []);

  const merged = users.map((u) => ({ ...u, online: onlineIds.has(u.id) }));
  return { users: merged, reload };
}

/** Format « actif il y a X » à partir d'un timestamp ISO. */
export function lastSeenLabel(iso: string | null, online: boolean): string {
  if (online) return 'en ligne';
  if (!iso) return 'jamais vu';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'à l’instant';
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  return `il y a ${d} j`;
}
