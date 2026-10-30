// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { api } from '@/lib/apiClient';
import { itemPath } from '../../pages/review/playlistNav';
import type { Notification, PlaylistDetail } from '../../types/api';

/**
 * Where a notification leads. Extracted from the bell so it can be tested on its own: this is the part that was going
 * wrong, and it went wrong silently: a click landing on the project page looks like a click that worked.
 *
 * `referenceId` only makes sense together with the type: a task, media or playlist id. The `REVIEW_DECISION` type was simply
 * missing from this table, so a review's most awaited notification, the verdict, fell back on the project page.
 */

/** Types whose reference is a media: the click opens its review. */
const MEDIA_TYPES = new Set([
  'REPLY',
  'COMMENT_ASSIGNED',
  // Review entrusted (Phase 49): the reference is the first media of the version, so the click
  // opens the screen where the requested work takes place.
  'REVIEW_ASSIGNED',
  // Review decision: same reference (first media of the version) since batch 9.
  //
  // The comparison is CASE-SENSITIVE, and deliberately so: rows written before this batch carry `review_decision` in lowercase
  // and, for the version's author, a VERSION id in `referenceId`. Including them here would open a randomly chosen media.
  // They therefore keep the "project page" fallback, which is what they already did.
  'REVIEW_DECISION',
  'MENTION',
  'WATCH',
]);

/** Immediate navigable target, or `null` if there is nothing to open. */
export function linkFor(n: Pick<Notification, 'type' | 'referenceId' | 'projectId'>): string | null {
  if (n.type === 'TASK_ASSIGNED' && n.referenceId) return `/tasks/${n.referenceId}`;
  if (MEDIA_TYPES.has(n.type) && n.referenceId) return `/review/${n.referenceId}`;
  if (n.projectId) return `/projects/${n.projectId}`;
  return null;
}

/**
 * LIVE notification (live review on a playlist, feedback round 33): leads directly to the session, i.e. the first readable
 * media of the playlist with `?playlist=&live=1`. Fallback: the project.
 */
export async function liveLinkFor(
  n: Pick<Notification, 'referenceId' | 'projectId'>,
): Promise<string | null> {
  if (!n.referenceId) return n.projectId ? `/projects/${n.projectId}` : null;
  try {
    const { playlist } = await api.get<{ playlist: PlaylistDetail }>(`/api/playlists/${n.referenceId}`);
    const first = playlist.items.find((it) => it.media);
    const path = first ? itemPath(first, playlist.id) : null;
    if (path) return `${path}&live=1`;
  } catch {
    // Playlist deleted or inaccessible: fall back on the project page.
  }
  return n.projectId ? `/projects/${n.projectId}` : null;
}

/** Target of a notification, LIVE included: a single entry point for the caller. */
export function targetFor(
  n: Pick<Notification, 'type' | 'referenceId' | 'projectId'>,
): Promise<string | null> {
  return n.type === 'LIVE' ? liveLinkFor(n) : Promise.resolve(linkFor(n));
}
