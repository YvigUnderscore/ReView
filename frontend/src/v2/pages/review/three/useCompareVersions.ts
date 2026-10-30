// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useState } from 'react';
import type { MediaSummary } from '@/v2/types/api';

/**
 * Media of **other versions** selected for spatial comparison (3D and splat).
 *
 * The A/B comparison did not cross the version boundary: both viewers only listed the siblings of
 * the current version, whereas the most common review case is v003 against v004 of the same asset.
 * The version selector (`CompareSelect`), until then reserved for video and image, now feeds this
 * list; the rest of the mechanics (loading into the common scene, crossfade, side by side, linked
 * camera) is unchanged.
 *
 * The media summary is memoized with its identifier: the selector has already resolved it from the
 * version detail, so there is no need to request it again to display its name in the bar.
 */
export function useCompareVersions() {
  const [extras, setExtras] = useState<MediaSummary[]>([]);

  const add = useCallback((id: number, media?: MediaSummary) => {
    if (!media) return;
    setExtras((list) => (list.some((m) => m.id === id) ? list : [...list, media]));
  }, []);

  const remove = useCallback((id: number) => {
    setExtras((list) => list.filter((m) => m.id !== id));
  }, []);

  /** Exclusive replacement (simple A/B semantics of the single-version selector). */
  const set = useCallback((id: number | null, media?: MediaSummary) => {
    setExtras(id == null || !media ? [] : [media]);
  }, []);

  return { extras, ids: extras.map((m) => m.id), add, remove, set };
}

export type CompareVersionsState = ReturnType<typeof useCompareVersions>;

/**
 * Compared list = siblings of the current version, then media of other versions, without duplicates
 * (the same media can be reached by both paths) and in a stable order — the comparison bar is a tab
 * list, it must not reorder itself.
 */
export function mergeCompareMedia(
  siblings: readonly MediaSummary[],
  extras: readonly MediaSummary[],
): MediaSummary[] {
  const seen = new Set(siblings.map((m) => m.id));
  return [...siblings, ...extras.filter((m) => !seen.has(m.id))];
}
