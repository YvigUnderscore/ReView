// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useState, type RefObject } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { reviewPath } from '../../lib/slug';
import type { PlaylistDetail, PlaylistItemEntry } from '../../types/api';
import { carryParams } from '../review/playlistNav';
import { loadAutoAdvance, nextPlayableAfterMedia, saveAutoAdvance } from './playlistChain';

export interface PlaylistChain {
  /** La review est ouverte dans le contexte d'une playlist (`?playlist=`). */
  active: boolean;
  enabled: boolean;
  toggle: () => void;
  next: PlaylistItemEntry | null;
}

/**
 * Enchaînement de la playlist dans le lecteur : la fin d'un plan ouvre le suivant.
 *
 * Même mécanique que le montage automatique (`useTimelineChain`) — écoute de `ended`,
 * navigation en **remplacement** pour ne pas empiler vingt entrées d'historique. Quand la
 * review porte aussi un montage (`?timeline=`), c'est lui qui mène : deux enchaînements
 * sur le même événement navigueraient deux fois.
 */
export function usePlaylistChain(
  mediaId: number,
  videoRef: RefObject<HTMLVideoElement | null>,
): PlaylistChain {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const playlistId = Number(searchParams.get('playlist')) || 0;
  const timelineDriven = Number(searchParams.get('timeline')) > 0;
  const [enabled, setEnabled] = useState(loadAutoAdvance);

  const playlistQ = useQuery({
    queryKey: qk.playlist(playlistId),
    queryFn: () =>
      api.get<{ playlist: PlaylistDetail }>(`/api/playlists/${playlistId}`).then((d) => d.playlist),
    enabled: playlistId > 0,
  });

  const items = playlistQ.data?.items ?? [];
  const next = playlistId > 0 ? nextPlayableAfterMedia(items, mediaId) : null;

  const toggle = useCallback(() => {
    setEnabled((v) => {
      saveAutoAdvance(!v);
      return !v;
    });
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    const target = next?.media;
    if (!video || !enabled || timelineDriven || !target) return;
    const onEnded = () => void navigate(reviewPath(target) + carryParams(searchParams), { replace: true });
    video.addEventListener('ended', onEnded);
    return () => video.removeEventListener('ended', onEnded);
  }, [videoRef, enabled, timelineDriven, next, navigate, searchParams]);

  return { active: playlistId > 0, enabled, toggle, next };
}
