// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react';
import { playbackSource } from './mediaSource';
import { isStillClip } from './timelinePlayback';
import type { TimelineClip } from '../../types/api';

/**
 * Full-resolution source of a montage's still-image shots.
 *
 * A shot whose published version is an image does not go through the video element — a JPEG handed
 * to `<video>` fails demuxing and blocked playback of the whole montage. It therefore needs its own
 * source, resolved like a video's (`GET /api/media/:id`) but set in an `<img>`.
 *
 * Resolved URLs are kept per media: a montage returning to the same shot does not ask for its URL
 * again, and the switch stays instant. The returned value is DERIVED from this accumulator during
 * render — no synchronous `setState` in an effect, which would cascade renders at every shot change.
 */
export function useStillSource(clip: TimelineClip | null): string | null {
  const [resolved, setResolved] = useState<Record<number, string>>({});
  const mediaId = isStillClip(clip) ? (clip?.mediaId ?? null) : null;

  useEffect(() => {
    if (mediaId === null || resolved[mediaId]) return;
    let cancelled = false;
    void playbackSource(mediaId)
      .then((source) => {
        const url = source?.file ?? source?.url ?? null;
        if (!cancelled && url) setResolved((prev) => ({ ...prev, [mediaId]: url }));
      })
      .catch(() => {
        // Without a URL, the shot's thumbnail holds the place: a montage does not drop to black.
      });
    return () => {
      cancelled = true;
    };
  }, [mediaId, resolved]);

  if (mediaId === null) return null;
  // The thumbnail serves as immediate display while the full-resolution image arrives.
  return resolved[mediaId] ?? clip?.thumbnailUrl ?? null;
}
