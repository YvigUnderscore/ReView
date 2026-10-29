// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getSocket } from '@/lib/socket';
import { reviewPath } from '../../lib/slug';
import { useAuth } from '../../stores/useAuth';
import type { ImageViewApi } from '../../components/ImageReviewViewer';
import {
  cancelPendingLeave,
  driverMedia,
  schedulePendingLeave,
  type LiveParticipant,
  type LiveStatePayload,
  type LiveSyncPayload,
} from './liveSync';
import { applyPointer } from './live/pointerBus';
import { usePointerBroadcast } from './live/usePointerBroadcast';

export type { LiveParticipant, LiveStatePayload } from './liveSync';

export interface LiveSession {
  /** Key of the current session (`media:<id>` or `playlist:<id>`) — LIVE badges. */
  key: string;
  /** In session (joined and not left). */
  active: boolean;
  isPilot: boolean;
  /** Broadcast in progress (driver: pilot or co-pilot). */
  isDriver: boolean;
  pilotId: number | null;
  coHostIds: number[];
  driverId: number | null;
  participants: LiveParticipant[];
  /** Playback started muted (autoplay blocked): suggest turning the sound on. */
  needsUnmute: boolean;
  unmute: () => void;
  join: () => void;
  leave: () => void;
  handoff: (toUserId: number) => void;
  setCoHost: (toUserId: number, isCoHost: boolean) => void;
  /** Local interaction of a co-pilot (viewer click, zoom…) → immediate takeover. */
  claimInteraction: () => void;
}

/**
 * Live review room (33.B + CP-HUMAN feedback). Session identified by `playlist:<id>` (if `?playlist=`)
 * otherwise `media:<id>`. The **driver** (the pilot or co-pilot who last interacted) broadcasts at
 * `syncHz`: current media, playhead/pause, 3D/splat camera (DoF included), A/B comparison, image
 * zoom/pan. Viewers apply everything; `?live=1` joins automatically.
 */
export function useLiveSession({
  mediaId,
  kind,
  fps,
  syncHz,
  videoRef,
  programmaticSeekRef,
  captureCamera,
  restoreCamera,
  compareId,
  onCompareChange,
  compareMode,
  onCompareModeChange,
  wipe,
  onWipeApply,
  imageViewApiRef,
}: {
  mediaId: number;
  kind: string | undefined;
  fps: number;
  syncHz: number;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  programmaticSeekRef: React.MutableRefObject<boolean>;
  captureCamera: () => unknown;
  restoreCamera: (camera: unknown) => void;
  compareId: number | null;
  onCompareChange: (id: number | null) => void;
  /** Comparison mode + wipe bar — broadcast by the driver (feedback 33, diff 34.E). */
  compareMode: 'side' | 'wipe' | 'diff';
  onCompareModeChange: (mode: 'side' | 'wipe' | 'diff') => void;
  wipe: { pos: number; angle: number };
  onWipeApply: (pos: number, angle: number) => void;
  imageViewApiRef: React.MutableRefObject<ImageViewApi | null>;
}): LiveSession {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const selfId = useAuth((s) => s.user?.id) ?? 0;
  const playlistId = Number(searchParams.get('playlist')) || 0;
  const key = playlistId > 0 ? `playlist:${playlistId}` : `media:${mediaId}`;
  const wantLive = searchParams.get('live') === '1';

  const [state, setState] = useState<LiveStatePayload | null>(null);
  // `?live=1` on arrival = session already joined (piloted navigation) → active right away.
  const [active, setActive] = useState(() => wantLive);
  const [needsUnmute, setNeedsUnmute] = useState(false);
  const isPilot = active && state?.pilotId === selfId;
  const canDrive = active && (isPilot || (state?.coHostIds ?? []).includes(selfId));
  const isDriver = active && state?.driverId === selfId;
  // Applying a sync in progress: the video events that follow are not local interactions
  // (a co-pilot must not steal the hand while following).
  const applyingRef = useRef(false);
  // Mirror refs for the socket/interval callbacks (no re-subscription per tick): copied after each
  // render (the effect without dependencies runs on each commit).
  const is3d = kind === 'MODEL_3D' || kind === 'SPLAT';
  const mirror = {
    mediaId,
    is3d,
    kind,
    restoreCamera,
    captureCamera,
    compareId,
    onCompareChange,
    compareMode,
    onCompareModeChange,
    wipe,
    onWipeApply,
    // Name of the shared cursors: the bus only carries identifiers.
    participants: state?.participants ?? [],
  };
  const applyRef = useRef(mirror);
  useEffect(() => {
    applyRef.current = mirror;
  });

  const setLiveParam = useCallback(
    (on: boolean) =>
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (on) next.set('live', '1');
          else next.delete('live');
          return next;
        },
        { replace: true },
      ),
    [setSearchParams],
  );

  /** Composes the current state to broadcast (driver). */
  const buildPayload = useCallback(
    (action?: boolean): LiveSyncPayload => {
      const cur = applyRef.current;
      const payload: LiveSyncPayload = { mediaId: cur.mediaId };
      if (action) payload.action = true;
      const video = videoRef.current;
      if (video) {
        payload.t = video.currentTime;
        payload.playing = !video.paused;
      }
      if (cur.is3d) payload.camera = cur.captureCamera();
      if (cur.kind === 'VIDEO' || cur.kind === 'IMAGE') {
        payload.compareId = cur.compareId;
        // Active comparison: the mode (side by side/wipe) and the bar follow the driver.
        if (cur.compareId != null) {
          payload.compareMode = cur.compareMode;
          if (cur.compareMode === 'wipe') payload.wipe = cur.wipe;
        }
      }
      if (cur.kind === 'IMAGE') {
        const view = imageViewApiRef.current?.capture();
        if (view) payload.imageView = view;
      }
      return payload;
    },
    [videoRef, imageViewApiRef],
  );

  const join = useCallback(() => {
    cancelPendingLeave(key);
    getSocket().emit('live:join', key);
    setActive(true);
    setLiveParam(true);
  }, [key, setLiveParam]);

  const leave = useCallback(() => {
    cancelPendingLeave(key);
    getSocket().emit('live:leave', key);
    setActive(false);
    setState(null);
    setNeedsUnmute(false);
    setLiveParam(false);
  }, [key, setLiveParam]);

  const handoff = useCallback((toUserId: number) => getSocket().emit('live:handoff', key, toUserId), [key]);
  const setCoHost = useCallback(
    (toUserId: number, isCoHost: boolean) => getSocket().emit('live:cohost', key, toUserId, isCoHost),
    [key],
  );

  /** Local interaction of a pilot/co-pilot: immediate sync marked `action`. */
  const claimInteraction = useCallback(() => {
    // Already driver: the periodic broadcast is enough (avoids spamming emissions during a continuous
    // drag — wipe, zoom). The claim only serves to take the hand.
    if (!canDrive || isDriver || applyingRef.current) return;
    getSocket().emit('live:sync', key, buildPayload(true));
  }, [canDrive, isDriver, key, buildPayload]);

  const unmute = useCallback(() => {
    const video = videoRef.current;
    if (video) video.muted = false;
    setNeedsUnmute(false);
  }, [videoRef]);

  // Subscription to the session state + auto-join if the URL carries ?live=1.
  useEffect(() => {
    const socket = getSocket();
    const onState = (data: { key: string; state: LiveStatePayload | null }) => {
      if (data.key !== key) return;
      setState(data.state);
    };
    const rejoin = () => socket.emit('live:join', key);
    socket.on('live:state', onState);
    if (wantLive) {
      cancelPendingLeave(key);
      socket.emit('live:join', key);
      socket.on('connect', rejoin);
    }
    return () => {
      socket.off('live:state', onState);
      socket.off('connect', rejoin);
      // Deferred departure: cancelled if the next review (same session) comes back right away.
      if (wantLive) schedulePendingLeave(key);
    };
  }, [key, wantLive]);

  // Local navigation of a co-pilot (not following the driver) → immediate takeover.
  useEffect(() => {
    if (!canDrive || isDriver || driverMedia.lastId === 0 || driverMedia.lastId === mediaId) return;
    claimInteraction();
    // Deliberately depends only on mount/state: one navigation = one claim.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canDrive, isDriver, mediaId]);

  // Viewer (and non-driver co-pilot): applies the driver's state.
  useEffect(() => {
    if (!active || isDriver) return;
    const socket = getSocket();
    const onSync = (data: { key: string; payload: LiveSyncPayload }) => {
      if (data.key !== key) return;
      const { payload } = data;
      const cur = applyRef.current;
      applyingRef.current = true;
      try {
        if (payload.mediaId !== cur.mediaId) {
          driverMedia.lastId = payload.mediaId;
          const carry = new URLSearchParams();
          if (playlistId > 0) carry.set('playlist', String(playlistId));
          carry.set('live', '1');
          void navigate(`${reviewPath({ id: payload.mediaId })}?${carry.toString()}`);
          return;
        }
        driverMedia.lastId = payload.mediaId;
        const video = videoRef.current;
        if (video && payload.t !== undefined) {
          // Resync: frame-accurate when paused (frames must line up), with tolerance during playback
          // (avoids jerks).
          const drift = Math.abs(video.currentTime - payload.t);
          const threshold = payload.playing ? 0.35 : 1 / (fps || 24) / 2 + 0.001;
          if (drift > threshold) {
            programmaticSeekRef.current = true;
            video.currentTime = payload.t;
          }
          if (payload.playing === true && video.paused) {
            // Autoplay without prior interaction: fall back to muted playback (allowed by browsers) and
            // offer to turn the sound on.
            void video.play().catch(() => {
              video.muted = true;
              setNeedsUnmute(true);
              void video.play().catch(() => undefined);
            });
          } else if (payload.playing === false && !video.paused) video.pause();
        }
        if (payload.camera !== undefined && cur.is3d) cur.restoreCamera(payload.camera);
        if (payload.compareId !== undefined && payload.compareId !== cur.compareId)
          cur.onCompareChange(payload.compareId);
        if (payload.compareMode !== undefined && payload.compareMode !== cur.compareMode)
          cur.onCompareModeChange(payload.compareMode);
        if (payload.wipe && (payload.wipe.pos !== cur.wipe.pos || payload.wipe.angle !== cur.wipe.angle))
          cur.onWipeApply(payload.wipe.pos, payload.wipe.angle);
        if (payload.imageView && cur.kind === 'IMAGE') imageViewApiRef.current?.apply(payload.imageView);
        // Driver's cursor: lightweight frame, outside the sync cadence.
        applyPointer(payload, cur.participants);
      } finally {
        // Deferred reset: the play/pause/seeked events resulting from the application arrive after
        // this handler (same tick or next task).
        setTimeout(() => {
          applyingRef.current = false;
        }, 0);
      }
    };
    socket.on('live:sync', onSync);
    return () => {
      socket.off('live:sync', onSync);
    };
  }, [active, isDriver, key, playlistId, fps, navigate, videoRef, programmaticSeekRef, imageViewApiRef]);

  // Non-driver co-pilot: a local video command (play/pause/seek) takes the hand.
  useEffect(() => {
    if (!canDrive || isDriver) return;
    const video = videoRef.current;
    if (!video) return;
    const onLocalCommand = () => {
      if (applyingRef.current || programmaticSeekRef.current) return;
      claimInteraction();
    };
    video.addEventListener('play', onLocalCommand);
    video.addEventListener('pause', onLocalCommand);
    video.addEventListener('seeked', onLocalCommand);
    return () => {
      video.removeEventListener('play', onLocalCommand);
      video.removeEventListener('pause', onLocalCommand);
      video.removeEventListener('seeked', onLocalCommand);
    };
  }, [canDrive, isDriver, videoRef, programmaticSeekRef, claimInteraction]);

  // Non-driver co-pilot: a click in a 3D/splat viewer (canvas) takes the hand.
  useEffect(() => {
    if (!canDrive || isDriver || !applyRef.current.is3d) return;
    const onPointerDown = (e: PointerEvent) => {
      if ((e.target as Element | null)?.closest?.('canvas')) claimInteraction();
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [canDrive, isDriver, claimInteraction]);

  // Shared cursor (studio leftover): "there, this thing" had no visual support.
  usePointerBroadcast({ active, isDriver, sessionKey: key, selfId, mediaId });

  // Driver: broadcasts the current state at `syncHz` (admin-adjustable per media type).
  useEffect(() => {
    if (!isDriver) return;
    const socket = getSocket();
    const tick = () => socket.emit('live:sync', key, buildPayload());
    tick();
    const interval = window.setInterval(tick, Math.round(1000 / Math.min(30, Math.max(1, syncHz))));
    return () => window.clearInterval(interval);
  }, [isDriver, key, syncHz, buildPayload]);

  return {
    key,
    active,
    isPilot,
    isDriver,
    pilotId: state?.pilotId ?? null,
    coHostIds: state?.coHostIds ?? [],
    driverId: state?.driverId ?? null,
    participants: state?.participants ?? [],
    needsUnmute,
    unmute,
    join,
    leave,
    handoff,
    setCoHost,
    claimInteraction,
  };
}
