// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { getToken } from '../../../lib/apiClient';
import { getSocket } from '../../../lib/socket';
import { applyHlsAuth, isExpiredMediaUrlError, MAX_HLS_REFRESHES } from './hlsSource';
import { canUseHlsJs, loadHls, type HlsInstance } from './hlsRuntime';

export interface HlsLevel {
  height: number;
  bitrate: number;
}

/**
 * HLS playback (Phase 23) via hls.js (MSE). The **manifests** are served by the authenticated API
 * `/api/media/:id/hls/*` (the JWT is injected by `xhrSetup`); since wave 2, the **segments** are
 * referenced there by presigned MinIO URLs and no longer go through the backend — hence two rules
 * carried by `hlsSource`: the session token only follows API URLs, and a stale signature is repaired
 * by reloading the manifest. Without MSE support (`active=false`), the caller falls back to the MP4
 * proxy.
 *
 * Deliberately minimal quality system (rework 2026-07-18):
 * - **no ABR**: playback starts locked on the highest rendition; the displayed quality is always the
 *   quality served;
 * - change **during playback** → `nextLevel`: switches at the next fragment, without a flush at the
 *   current position — no buffer hole is possible, hence never sound over a frozen image;
 * - change **while paused** → `currentLevel`: flush to refresh the displayed frame, followed by a
 *   micro-seek to resync if the decoder no longer has an image under its head;
 * - **no automatic** quality switching (the low↔high back-and-forth of scrubbing was the source of
 *   buffer holes);
 * - `switching` = UI feedback of the ongoing change, cleared by LEVEL_SWITCHED or by a safeguard (the
 *   spinner cannot get stuck).
 *
 * The library itself is loaded **on demand** (`hlsRuntime`): it no longer weighs on image, 3D or splat
 * reviews. The "HLS or MP4?" decision is still made at the first render; without the library, the screen
 * would not shift at all.
 *
 * Progressive scale (34.F): `mediaId` provided → on the `hls:changed` event (review room, new transcoded
 * renditions), the master is reloaded preserving position/playback; quality is re-locked on the highest,
 * unless manually chosen.
 */
export function useHlsPlayer(
  videoRef: RefObject<HTMLVideoElement | null>,
  hlsUrl: string | null,
  mediaId?: number,
) {
  const [levels, setLevels] = useState<HlsLevel[]>([]);
  const [level, setLevelState] = useState(0);
  const [switching, setSwitching] = useState(false);
  const hlsRef = useRef<HlsInstance | null>(null);
  const switchTimer = useRef<number | undefined>(undefined);
  // Source whose player chunk could not be downloaded (network cut at the wrong moment): we fall back
  // to the MP4 path instead of leaving a video element without a source. Storing the URL rather than a
  // boolean avoids having to reset it — a next media is not the one that failed.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const active = canUseHlsJs(hlsUrl) && failedUrl !== hlsUrl;
  // Master reload (34.F): generation bumped by the socket event; playback state (position/pause) and
  // the manual quality choice survive the re-attach.
  const [gen, setGen] = useState(0);
  const restoreRef = useRef<{ t: number; paused: boolean } | null>(null);
  const manualHeightRef = useRef<number | null>(null);
  // Reloads triggered by a stale segment URL — bounded (see MAX_HLS_REFRESHES).
  const refreshesRef = useRef(0);

  /** Reloads the manifest while preserving position and playback state. */
  const reloadSource = useCallback(() => {
    const video = videoRef.current;
    restoreRef.current = { t: video?.currentTime ?? 0, paused: video?.paused ?? true };
    setGen((g) => g + 1);
  }, [videoRef]);

  const markSwitching = useCallback(() => {
    setSwitching(true);
    window.clearTimeout(switchTimer.current);
    switchTimer.current = window.setTimeout(() => setSwitching(false), 4000);
  }, []);

  useEffect(() => {
    if (!videoRef.current || !hlsUrl || !canUseHlsJs(hlsUrl)) return;
    // Lazy loading (F2): the library is only requested here, hence only for a real video. `disposed`
    // covers an unmount that happened during the download — without it, a player would attach to an
    // already removed element.
    let disposed = false;
    let player: HlsInstance | null = null;
    void loadHls().then(
      (HlsCtor) => {
        const video = videoRef.current;
        if (disposed || !video) return;
        const hls = new HlsCtor({
          xhrSetup: (xhr, url) => applyHlsAuth(xhr, url, getToken()),
        });
        player = hls;
        hlsRef.current = hls;
        hls.attachMedia(video);
        hls.loadSource(hlsUrl);
        hls.on(HlsCtor.Events.MANIFEST_PARSED, () => {
          setLevels(hls.levels.map((l) => ({ height: l.height, bitrate: l.bitrate })));
          // Locks the best rendition before the first fragment (no ABR) — unless a quality was chosen
          // manually, kept across a 34.F reload.
          let target = 0;
          hls.levels.forEach((l, i) => {
            if (l.height > hls.levels[target].height) target = i;
          });
          const manual = manualHeightRef.current;
          if (manual != null) {
            const idx = hls.levels.findIndex((l) => l.height === manual);
            if (idx >= 0) target = idx;
          }
          setLevelState(target);
          hls.currentLevel = target;
          // Resume after the master reload (34.F): position and playback restored.
          const restore = restoreRef.current;
          restoreRef.current = null;
          if (restore && video) {
            video.currentTime = restore.t;
            if (!restore.paused) void video.play().catch(() => undefined);
          }
        });
        hls.on(HlsCtor.Events.LEVEL_SWITCHED, () => {
          window.clearTimeout(switchTimer.current);
          setSwitching(false);
          // After a flush while paused, the decoder may no longer have an image under the playhead:
          // micro-seek in place to reload the segment and refresh the frame.
          if (video.paused && video.readyState < 3)
            video.currentTime = Math.max(0, video.currentTime - 0.001);
        });
        // Segment refused by storage: its signature expired (session longer than its validity period).
        // The manifest itself remains accessible — we request it again, which yields a set of fresh URLs,
        // position and playback preserved.
        hls.on(HlsCtor.Events.ERROR, (_evt, data) => {
          if (!isExpiredMediaUrlError(data) || refreshesRef.current >= MAX_HLS_REFRESHES) return;
          refreshesRef.current += 1;
          reloadSource();
        });
      },
      () => {
        // MP4 fallback: `active` drops to false, the video element receives `src` at the next render.
        if (!disposed) setFailedUrl(hlsUrl);
      },
    );
    return () => {
      disposed = true;
      player?.destroy();
      hlsRef.current = null;
      window.clearTimeout(switchTimer.current);
      setLevels([]);
      setSwitching(false);
    };
  }, [videoRef, hlsUrl, gen, reloadSource]);

  // New media: the reload counter starts again from zero.
  useEffect(() => {
    refreshesRef.current = 0;
  }, [hlsUrl]);

  // Progressive scale (34.F): new renditions are ready → reloads the master.
  useEffect(() => {
    if (!active || !mediaId) return;
    const socket = getSocket();
    const onChanged = (e: { mediaId: number; renditions: number }) => {
      if (e.mediaId !== mediaId || e.renditions <= levels.length) return;
      reloadSource();
    };
    socket.on('hls:changed', onChanged);
    return () => {
      socket.off('hls:changed', onChanged);
    };
  }, [active, mediaId, levels.length, reloadSource]);

  /** Changes the playback quality (rendition index). */
  const setLevel = (idx: number) => {
    setLevelState(idx);
    // Manual choice: kept if the master is reloaded (new 34.F renditions).
    manualHeightRef.current = levels[idx]?.height ?? null;
    const hls = hlsRef.current;
    if (!hls || hls.currentLevel === idx) return;
    markSwitching();
    const video = videoRef.current;
    if (video && !video.paused) hls.nextLevel = idx;
    else hls.currentLevel = idx;
  };

  return { active, levels, level, setLevel, switching };
}
