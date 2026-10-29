// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/apiClient';
import { qk } from '@/v2/lib/query';
import { decodeWaveformPeaks, type WaveformMeta } from './waveformData';

/** Media response, reduced to the only field we need (cache shared with the review). */
interface MediaWaveformResp {
  waveform?: WaveformMeta | null;
}

const STORAGE_KEY = 'review:video:waveform';

const loadVisible = (): boolean => {
  try {
    return localStorage.getItem(STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
};

export interface WaveformTrack {
  /** The media carries a waveform (transcoded with sound). */
  available: boolean;
  /** Peaks ready to draw — `null` while it is absent or hidden. */
  peaks: Uint8Array | null;
  visible: boolean;
  toggle: () => void;
}

/**
 * Waveform of the current media (wave 5 finding: nothing existed on the sound side).
 *
 * It travels in the `/api/media/:id` response already loaded by the review — same cache key,
 * infinite `staleTime`: no extra request, no audio decoding in the browser. Hideable, and the
 * choice is remembered from one media to another.
 */
export function useWaveform(mediaId: number): WaveformTrack {
  const [visible, setVisible] = useState(loadVisible);
  const q = useQuery({
    queryKey: qk.media(mediaId),
    queryFn: () => api.get<MediaWaveformResp>(`/api/media/${mediaId}`),
    staleTime: Infinity,
    enabled: mediaId > 0,
  });
  const peaks = useMemo(() => decodeWaveformPeaks(q.data?.waveform), [q.data?.waveform]);

  const toggle = useCallback(() => {
    setVisible((v) => {
      const next = !v;
      try {
        localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {
        // Storage unavailable (private browsing): session-only choice.
      }
      return next;
    });
  }, []);

  return { available: peaks !== null, peaks: visible ? peaks : null, visible, toggle };
}
