// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react';
import { getSocket } from '../../../lib/socket';
import { useAuth } from '../../stores/useAuth';

/** Spectateur d'une review (payload socket `review:presence`). */
export interface ReviewViewer {
  id: number;
  displayName: string;
  initials: string;
  avatarUrl: string | null;
}

/**
 * Présence sur une review : rejoint la room socket du média (RBAC revérifié
 * serveur), écoute la liste des spectateurs et la renvoie sans soi-même.
 * Quitte la room au démontage ; re-join après une reconnexion socket.
 */
export function useReviewPresence(mediaId: number): ReviewViewer[] {
  const selfId = useAuth((s) => s.user?.id) ?? 0;
  const [viewers, setViewers] = useState<ReviewViewer[]>([]);

  useEffect(() => {
    if (!mediaId) return;
    const socket = getSocket();
    const join = () => socket.emit('join_review', mediaId);
    const onPresence = (data: { mediaId: number; viewers: ReviewViewer[] }) => {
      if (data.mediaId === mediaId) setViewers(data.viewers);
    };
    join();
    socket.on('connect', join);
    socket.on('review:presence', onPresence);
    return () => {
      socket.emit('leave_review', mediaId);
      socket.off('connect', join);
      socket.off('review:presence', onPresence);
    };
  }, [mediaId]);

  return viewers.filter((v) => v.id !== selfId);
}
