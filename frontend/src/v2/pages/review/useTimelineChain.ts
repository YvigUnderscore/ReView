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
 * Lecture d'un montage automatique dans le lecteur de review (Phase 45).
 *
 * Actif quand la review est ouverte avec `?timeline=ID`. Deux services :
 *  - la navigation manuelle (plan précédent / suivant) ;
 *  - l'ENCHAÎNEMENT : la fin d'un plan passe au suivant, ce qui fait la différence entre
 *    « une liste de plans » et « un montage ». Les cartons sont sautés à la lecture, mais
 *    restent comptés dans le montage : c'est là qu'on voit ce qui manque.
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

/** Paramètres d'URL à conserver d'un plan à l'autre (montage, session live). */
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
        // La lecture continue : empiler chaque plan obligerait à autant de retours arrière
        // pour sortir du montage.
        { replace: true },
      );
    },
    [navigate, searchParams],
  );

  // Enchaînement : le plan suivant démarre là où le précédent s'arrête.
  useEffect(() => {
    const video = videoRef?.current;
    if (!video || timelineId <= 0 || !next) return;
    const onEnded = () => go(next);
    video.addEventListener('ended', onEnded);
    return () => video.removeEventListener('ended', onEnded);
  }, [videoRef, timelineId, next, go]);

  return { timeline, clips, index, position, total, previous, next, go };
}
