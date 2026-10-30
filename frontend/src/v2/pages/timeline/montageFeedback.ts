// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { stripHtml } from '../../lib/richText';
import type { ReviewComment, TimelineClip } from '../../types/api';

/**
 * Notes left on a montage — PURE analysis, tested (Phase 46).
 *
 * A montage note carries two positions: its frame WITHIN the shot (`timestamp`, which allows
 * sending it back exactly there on the shot's review) and its position in the whole film
 * (`timelineTime`, the only scale a single timeline can display). This file holds the mapping
 * between the two.
 */

/**
 * A montage note IS a review comment: the thread, the right click and the replies are the same
 * components as elsewhere. Only its position in the film and the trace of its sending are added.
 */
export interface MontageComment extends ReviewComment {
  timelineTime: number | null;
  sharedToShot: boolean;
}

/** The shot a note falls on, in plain text: "SQ020 · SH010". */
export function shotLabelOf(
  clips: readonly TimelineClip[],
  mediaObjectId: number | null | undefined,
): string {
  const clip = clips.find((c) => c.mediaId !== null && c.mediaId === mediaObjectId);
  if (!clip) return '—';
  return clip.sequenceCode ? `${clip.sequenceCode} · ${clip.shotCode}` : clip.shotCode;
}

/** Marker of a note on the montage band. */
export interface CommentMarker {
  id: number;
  time: number;
  label: string;
  shared: boolean;
}

/**
 * Markers to place on the timeline.
 *
 * A note whose position in the film is unknown is put back at the start of the shot it targets,
 * rather than discarded: an invisible note is a lost note.
 */
export function commentMarkers(
  comments: readonly MontageComment[],
  clips: readonly TimelineClip[],
): CommentMarker[] {
  return comments.map((c) => {
    const clip = clips.find((x) => x.mediaId !== null && x.mediaId === c.mediaObjectId);
    const fallback = clip ? clip.startTime + Math.min(c.timestamp ?? 0, clip.duration) : 0;
    return {
      id: c.id,
      time: c.timelineTime ?? fallback,
      label: `${shotLabelOf(clips, c.mediaObjectId)} — ${stripHtml(c.content).slice(0, 60)}`,
      shared: c.sharedToShot,
    };
  });
}
