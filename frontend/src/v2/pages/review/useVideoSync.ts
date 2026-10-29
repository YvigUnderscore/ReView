// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, type RefObject } from 'react';
import { useCompareOffset } from './compareOffset';

/** Beyond this gap, the slave video has drifted from the master and we resync it. */
const DRIFT_TOLERANCE_SEC = 0.15;

/**
 * Synchronizes a slave video on a master player (14.C — extracted from VideoComparePane):
 * play/pause/seek/speed + drift correction during playback. Reused by the side-by-side and wipe modes
 * of the A/B comparison.
 *
 * The target is no longer "same time" but "same time, offset by so much": the comparison offset (see
 * `compareOffset.ts`) is added to the master's position. At zero — the ordinary case — the behavior is
 * exactly that of before.
 */
export function useVideoSync(
  masterRef: RefObject<HTMLVideoElement | null>,
  slaveRef: RefObject<HTMLVideoElement | null>,
  ready: boolean,
) {
  // Adjustable conform offset (retime, handles, entry point moved between two versions).
  const offsetSec = useCompareOffset((s) => s.seconds);

  useEffect(() => {
    const m = masterRef.current;
    const s = slaveRef.current;
    if (!m || !s || !ready) return;
    /** Position targeted by the slave, clamped to the duration it knows. */
    const target = () => {
      const wanted = m.currentTime + offsetSec;
      const max = Number.isFinite(s.duration) && s.duration > 0 ? s.duration : Number.POSITIVE_INFINITY;
      return Math.max(0, Math.min(wanted, max));
    };
    const syncTime = () => {
      s.currentTime = target();
    };
    const onPlay = () => {
      syncTime();
      void s.play().catch(() => undefined);
    };
    const onPause = () => {
      s.pause();
      syncTime();
    };
    const onRate = () => {
      s.playbackRate = m.playbackRate;
    };
    // Drift correction: the two players decode independently.
    const onTime = () => {
      if (!m.paused && Math.abs(s.currentTime - target()) > DRIFT_TOLERANCE_SEC) syncTime();
    };
    m.addEventListener('play', onPlay);
    m.addEventListener('pause', onPause);
    m.addEventListener('seeking', syncTime);
    m.addEventListener('ratechange', onRate);
    m.addEventListener('timeupdate', onTime);
    s.playbackRate = m.playbackRate;
    syncTime();
    if (!m.paused) void s.play().catch(() => undefined);
    return () => {
      m.removeEventListener('play', onPlay);
      m.removeEventListener('pause', onPause);
      m.removeEventListener('seeking', syncTime);
      m.removeEventListener('ratechange', onRate);
      m.removeEventListener('timeupdate', onTime);
    };
  }, [masterRef, slaveRef, ready, offsetSec]);
}
