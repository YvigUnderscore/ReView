// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { getSocket } from '@/lib/socket';
import type { ImageView } from '../../components/ImageReviewViewer';

/**
 * Types and helpers of the live session (33.B), shared by `useLiveSession` (extracted to respect
 * the 300-line budget). Module state: deferred departures and the driver's last media.
 */

/** Participant of a live session (`live:state` socket payload). */
export interface LiveParticipant {
  id: number;
  displayName: string;
  initials: string;
  avatarUrl: string | null;
}

export interface LiveStatePayload {
  key: string;
  pilotId: number;
  coHostIds: number[];
  /** Pilot or co-pilot whose broadcast is authoritative (last to have interacted). */
  driverId: number;
  participants: LiveParticipant[];
}

/** State broadcast by the driver, applied as is by the viewers. */
export interface LiveSyncPayload {
  mediaId: number;
  t?: number;
  playing?: boolean;
  camera?: unknown;
  compareId?: number | null;
  /** Comparison mode (side by side / wipe / diff 34.E) + wipe bar (returns 33). */
  compareMode?: 'side' | 'wipe' | 'diff';
  wipe?: { pos: number; angle: number };
  imageView?: ImageView;
  /** Explicit interaction (play/seek/navigation/zoom): counts as a co-pilot taking over. */
  action?: boolean;
}

/**
 * Deferred departures per session key. Internal navigation (next media of a playlist) unmounts,
 * then remounts the hook. `live:leave` is only emitted if no new mount has resumed the session in
 * the meantime (otherwise the driver would lose control).
 */
const pendingLeaves = new Map<string, number>();

export const cancelPendingLeave = (key: string): void => {
  const t = pendingLeaves.get(key);
  if (t !== undefined) {
    window.clearTimeout(t);
    pendingLeaves.delete(key);
  }
};

export const schedulePendingLeave = (key: string): void => {
  cancelPendingLeave(key);
  pendingLeaves.set(
    key,
    window.setTimeout(() => {
      pendingLeaves.delete(key);
      getSocket().emit('live:leave', key);
    }, 1500),
  );
};

/** Last media imposed by the driver: distinguishes followed navigation from local navigation. */
export const driverMedia = { lastId: 0 };
