// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, type RefObject } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { reviewPath } from '../../lib/slug';
import { clipIndexOfMedia, playableNeighbor, playablePosition } from './timelineNav';
import type { TimelineClip, TimelineView } from '../../types/api';

/**
 * Playback of an automatic montage in the review player (Phase 45).
 *
 * Active when the review is opened with `?timeline=ID`. Two services:
 *  - manual navigation (previous / next shot);
 *  - the CHAINING: the end of a shot passes to the next one, which makes the difference between
 *    "a list of shots" and "a montage". Title cards are skipped on playback but stay counted in the
 *    montage: that is where what is missing shows.
 */
export interface TimelineChain {
  timeline: TimelineView | null;
  clips: TimelineClip[];
  index: number;
  position: number;
  total: number;
  previous: TimelineClip | null;
  next: TimelineClip | null;
  go: (clip: TimelineClip | null) => void;
}

/** URL parameters to keep from one shot to the next (montage, live session). */
function carry(params: URLSearchParams): string {
  const out = new URLSearchParams();
  for (const key of ['timeline', 'live']) {
    const value = params.get(key);
    if (value) out.set(key, value);
  }
  const qs = out.toString();
  return qs ? `?${qs}` : '';
}

export function useTimelineChain(
  mediaId: number | null,
  videoRef?: RefObject<HTMLVideoElement | null>,
): TimelineChain {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const timelineId = Number(searchParams.get('timeline')) || 0;

  const timelineQ = useQuery({
    queryKey: qk.timeline(timelineId),
    queryFn: () =>
      api.get<{ timeline: TimelineView }>(`/api/timelines/${timelineId}`).then((d) => d.timeline),
    enabled: timelineId > 0,
  });

  const timeline = timelineQ.data ?? null;
  const clips = timeline?.items ?? [];
  const index = mediaId !== null ? clipIndexOfMedia(clips, mediaId) : -1;
  const { position, total } = playablePosition(clips, index);
  const previous = playableNeighbor(clips, index, -1);
  const next = playableNeighbor(clips, index, 1);

  const go = useCallback(
    (clip: TimelineClip | null) => {
      if (!clip || clip.mediaId === null) return;
      void navigate(
        reviewPath({ id: clip.mediaId, originalName: clip.mediaName }) + carry(searchParams),
        // Playback continues: stacking each shot would require as many back steps to leave the
        // montage.
        { replace: true },
      );
    },
    [navigate, searchParams],
  );

  // Chaining: the next shot starts where the previous one stops.
  useEffect(() => {
    const video = videoRef?.current;
    if (!video || timelineId <= 0 || !next) return;
    const onEnded = () => go(next);
    video.addEventListener('ended', onEnded);
    return () => video.removeEventListener('ended', onEnded);
  }, [videoRef, timelineId, next, go]);

  return { timeline, clips, index, position, total, previous, next, go };
}
