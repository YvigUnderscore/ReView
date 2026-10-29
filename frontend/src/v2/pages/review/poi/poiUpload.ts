// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  isAllowedAttachment,
  MAX_COMMENT_ATTACHMENTS,
  type CommentAttachment,
} from '@/v2/lib/commentAttachments';
import type { PoiDraft } from './usePoiDraft';
import type { PoiPoint } from './poiPoints';

/**
 * The point images go in the SAME attachment list as those of the composer: a single upload, and a
 * single carrying comment. Each point then notes which are its own, by their key.
 *
 * All the delicate work is here, and it is pure: deciding which files leave, in what order, and which are
 * lost at the ceiling. The upload itself merely follows the plan.
 */
export interface PoiUploadPlan {
  /** Files to upload, in this order: those of the points first, then those of the composer. */
  files: File[];
  /** Number of files retained per point, in the order of the points. */
  counts: number[];
  /** Files set aside (refused type or ceiling reached): the caller tells the author. */
  dropped: number;
}

/**
 * Point images go AHEAD: a point's image IS its remark, whereas a composer attachment is joined by a
 * following message. Files of a refused type are set aside here, before sending. This is what guarantees
 * that the upload returns **one attachment per file, in order**, and therefore that the split by key is exact.
 */
export function poiUploadPlan(
  points: readonly PoiDraft[],
  extra: readonly File[],
  max: number = MAX_COMMENT_ATTACHMENTS,
): PoiUploadPlan {
  const files: File[] = [];
  const counts: number[] = [];
  let dropped = 0;
  const take = (file: File): boolean => {
    if (!isAllowedAttachment(file.type) || files.length >= max) {
      dropped += 1;
      return false;
    }
    files.push(file);
    return true;
  };
  for (const point of points) {
    let kept = 0;
    for (const file of point.files) if (take(file)) kept += 1;
    counts.push(kept);
  }
  for (const file of extra) take(file);
  return { files, counts, dropped };
}

/**
 * Points ready to be stored: the geometry, the remark, and the keys of the attachments that belong to
 * them, split in the order of the plan.
 */
export function poiStoredPoints(
  points: readonly PoiDraft[],
  plan: PoiUploadPlan,
  uploaded: readonly CommentAttachment[],
): PoiPoint[] {
  let at = 0;
  return points.map((point, i) => {
    const images = uploaded.slice(at, at + (plan.counts[i] ?? 0)).map((a) => a.key);
    at += plan.counts[i] ?? 0;
    const text = point.text.trim();
    return {
      position: point.position,
      normal: point.normal,
      ...(point.space ? { space: point.space } : {}),
      ...(text ? { text } : {}),
      ...(images.length ? { images } : {}),
    };
  });
}
