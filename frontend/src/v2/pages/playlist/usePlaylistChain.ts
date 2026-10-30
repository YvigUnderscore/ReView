// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useState, type RefObject } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/apiClient';
import { qk } from '../../lib/query';
import { reviewPath } from '../../lib/slug';
import type { PlaylistDetail, PlaylistItemEntry } from '../../types/api';
import { carryParams } from '../review/playlistNav';
import { loadAutoAdvance, nextPlayableAfterMedia, saveAutoAdvance } from './playlistChain';

export interface PlaylistChain {
  /** The review is opened in the context of a playlist (`?playlist=`). */
  active: boolean;
  enabled: boolean;
  toggle: () => void;
  next: PlaylistItemEntry | null;
}

/**
 * Chaining of the playlist in the player: the end of a shot opens the next one.
 *
 * Same mechanism as the automatic edit (`useTimelineChain`): listening to `ended`, and navigating
 * with **replacement** so as not to stack twenty history entries. When the review also carries an
 * edit (`?timeline=`), it is that one which leads: two chainings on the same event would navigate
 * twice.
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
