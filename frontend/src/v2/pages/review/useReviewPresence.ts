// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react';
import { getSocket } from '../../../lib/socket';
import { useAuth } from '../../stores/useAuth';

/** Spectator of a review (`review:presence` socket payload). */
export interface ReviewViewer {
  id: number;
  displayName: string;
  initials: string;
  avatarUrl: string | null;
}

/**
 * Presence on a review: joins the media's socket room (RBAC re-checked server-side), listens to the
 * list of spectators and returns it without oneself. Leaves the room on unmount; re-joins after a
 * socket reconnection.
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
