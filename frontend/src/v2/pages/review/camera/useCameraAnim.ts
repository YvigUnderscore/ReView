// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState } from 'react';
import { isEditable } from '../../../lib/shortcuts';
import type { SplatCamera } from '../reviewTypes';
import { isFlyMoveCode } from '../viewer/flyControls';
import {
  animBase,
  animDuration,
  animKeyTimes,
  animPlayDuration,
  baseChannelValues,
  CHANNEL_IDS,
  deleteColumn,
  emptyAnim,
  hasAnimation as animHasAnimation,
  moveColumn,
  moveKeysBatch,
  poseToChannelValues,
  seedAnimBase,
  setAnimDuration,
  setChannelExtrapolation,
  upsertKey,
  upsertPoseAt,
  type CameraAnimV2,
  type ChannelId,
  type Extrapolation,
  type TangentType,
} from './channels/model';
import {
  channelRefs,
  setTangentSlope,
  setTangentType,
  type TangentSide,
  type TangentTarget,
} from './channels/tangents';
import { evalChannel } from './channels/hermite';
import { sampleAnimV2 } from './channels/hermite';
import { useCameraAutoKey } from './useCameraAutoKey';
import { useCurveSelection } from './useCurveSelection';

/**
 * Minimal camera controller required by the animation player/editor — shared by **3D and splat**:
 * render loop, pose apply/capture, canvas (auto-pause on any input).
 */
export interface CameraController {
  subscribeFrame(cb: (dt: number) => void): () => void;
  restoreCamera(state: unknown): void;
  captureCamera(): SplatCamera | undefined;
  getDom(): HTMLElement | null;
}

const HISTORY_LIMIT = 100;

/**
 * Camera animation player + editor over F-curves (Phase 17, v2; Phase 27): transport
 * (play/pause/scrub, loop **0→adjustable duration**), per-frame Hermite sampling, **automatic
 * takeover** (any input pauses), key editing (set from the view, **multi-selection** + grouped
 * move, tangents, batch delete) and local undo/redo. Optional **auto-key**: any camera gesture
 * sets a key at the playback time. Playback relies on `subscribeFrame`.
 */
export function useCameraAnim(controller: CameraController) {
  const { subscribeFrame, restoreCamera, captureCamera, getDom } = controller;
  const [anim, setAnimState] = useState<CameraAnimV2>(() => emptyAnim());
  const [playing, setPlaying] = useState(false);
  const [autoPaused, setAutoPaused] = useState(false);
  const [timeMs, setTimeMs] = useState(0);
  const [autoKey, setAutoKey] = useState(false);
  const [past, setPast] = useState<CameraAnimV2[]>([]);
  const [future, setFuture] = useState<CameraAnimV2[]>([]);

  const timeRef = useRef(0);
  const animRef = useRef(anim);
  /**
   * **Legacy** fallback for keyless channels: it is only used by animations that do not carry
   * their own base (`CameraAnimV2.base`) — those recorded before it, whose replay must not
   * change. A new animation carries its base, and that is the one that wins at sampling
   * (`channels/model.animBase`).
   */
  const baseRef = useRef<SplatCamera>({ position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } });
  useEffect(() => {
    animRef.current = anim;
  }, [anim]);

  /**
   * Every write that may create the **first** key goes through here: a new animation adopts the
   * current view as its persisted base, so its keyless channels are the same for the player, for
   * the scene rig and for every viewer. Without a base, an animation built with the gizmo (position
   * keyed, target unkeyed) saw its target jump to the world origin on the first scrub. A legacy
   * animation is returned as is: its replay does not change.
   *
   * The ref is updated **immediately**: within a single event turn, the gizmo gesture chains
   * `beginStroke` → `scrub` → key writes, and the sync effect of `animRef` has not run yet — so
   * the scrub would still sample without the base.
   */
  const seedBase = useCallback(
    (view?: SplatCamera) => {
      const next = seedAnimBase(animRef.current, view ?? captureCamera());
      if (next === animRef.current) return next;
      animRef.current = next;
      setAnimState(next);
      return next;
    },
    [captureCamera],
  );

  // ── Editing with history: each mutation pushes the current state (undo). ──
  const pushHistory = useCallback(() => {
    setPast((p) => [...p.slice(-HISTORY_LIMIT + 1), animRef.current]);
    setFuture([]);
  }, []);
  const commit = useCallback(
    (next: CameraAnimV2) => {
      pushHistory();
      setAnimState(next);
    },
    [pushHistory],
  );

  // Key multi-selection (graph editor) and clipboard — the last selected key is "primary"
  // (tangent handles, camera-object). Phase 27, 40.E.
  const {
    selection,
    setSelection,
    clearSelection,
    applyTangentType,
    setSelectionBroken,
    setSelectionWeighted,
    removeSelection,
    copySelection,
    paste,
    canPaste,
  } = useCurveSelection({ animRef, timeRef, commit });

  // Continuous gesture (drag of one/several keys/tangent): a single snapshot at the start, then
  // live updates without stacking — one undo cancels the whole gesture.
  const beginStroke = useCallback(() => {
    pushHistory();
    seedBase();
  }, [pushHistory, seedBase]);
  /**
   * Grouped move (multi-selection) recomputed from the baseline captured at the start of the drag:
   * the indices stay consistent for the whole gesture (Phase 27).
   */
  const strokeMoveKeys = useCallback(
    (baseline: CameraAnimV2, moves: Array<{ channel: ChannelId; index: number; t: number; v: number }>) =>
      setAnimState(moveKeysBatch(baseline, moves)),
    [],
  );
  /**
   * Slope (and weight) of one tangent side, live during the drag of a handle. The opposite side
   * is materialized by `setTangentSlope`: without it, pulling ONE handle made the other read as
   * zero and flattened the curve.
   */
  const strokeSetTangent = useCallback(
    (channel: ChannelId, index: number, side: TangentSide, slope: number, weight?: number) =>
      setAnimState(setTangentSlope(animRef.current, channel, index, side, slope, weight)),
    [],
  );
  /** Writes/overwrites several channels at time `t` (camera-object drag — auto-key). Live. */
  const strokeUpsertAt = useCallback(
    (t: number, values: Partial<Record<ChannelId, number>>) => {
      let next = seedBase();
      const time = Math.max(0, Math.round(t));
      for (const id of CHANNEL_IDS) {
        const v = values[id];
        if (v != null) next = upsertKey(next, id, time, v);
      }
      setAnimState(next);
    },
    [seedBase],
  );

  const undo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p;
      const prev = p[p.length - 1];
      setFuture((f) => [animRef.current, ...f]);
      setAnimState(prev);
      return p.slice(0, -1);
    });
  }, []);
  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const next = f[0];
      setPast((p) => [...p, animRef.current]);
      setAnimState(next);
      return f.slice(1);
    });
  }, []);

  // Replaces the whole animation (persisted presentation, preset, import) — captures the base pose.
  const setAnim = useCallback(
    (next: CameraAnimV2) => {
      timeRef.current = 0;
      setTimeMs(0);
      setPast([]);
      setFuture([]);
      clearSelection();
      const view = captureCamera();
      if (view) baseRef.current = view;
      setAnimState(next);
    },
    [captureCamera, clearSelection],
  );

  const setLoop = useCallback((loop: boolean) => commit({ ...animRef.current, loop }), [commit]);
  /** Adjustable playback duration (0/undefined = automatic = last key time). */
  const setDuration = useCallback(
    (ms: number | undefined) => commit(setAnimDuration(animRef.current, ms)),
    [commit],
  );

  // Playback loop: advances the time, samples the pose, applies it to the camera.
  useEffect(() => {
    if (!playing) return;
    return subscribeFrame((dt) => {
      timeRef.current += dt * 1000;
      const a = animRef.current;
      restoreCamera(sampleAnimV2(a, timeRef.current, baseRef.current));
      const duration = animPlayDuration(a);
      if (!a.loop && timeRef.current >= duration) setPlaying(false);
      // Smooth playhead: the UI follows every frame (React 18 batches renders) — a 100 ms throttle
      // made the playhead advance in jerks.
      setTimeMs(a.loop ? timeRef.current % Math.max(duration, 1) : timeRef.current);
    });
  }, [playing, subscribeFrame, restoreCamera]);

  // Automatic takeover: orbit/wheel/flight during playback → pause.
  useEffect(() => {
    if (!playing) return;
    const dom = getDom();
    if (!dom) return;
    const pause = () => {
      setPlaying(false);
      setAutoPaused(true);
    };
    const onKey = (e: KeyboardEvent) => {
      // Same flight key reference as `flyControls`, and same input guard: without it,
      // typing "was" in a comment would pause playback.
      if (isFlyMoveCode(e.code) && !isEditable(e.target)) pause();
    };
    dom.addEventListener('pointerdown', pause);
    dom.addEventListener('wheel', pause, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      dom.removeEventListener('pointerdown', pause);
      dom.removeEventListener('wheel', pause);
      window.removeEventListener('keydown', onKey);
    };
  }, [playing, getDom]);

  const play = useCallback(() => {
    setAutoPaused(false);
    setPlaying(true);
  }, []);
  const pause = useCallback(() => {
    setPlaying(false);
    setAutoPaused(false);
  }, []);

  /** Positions playback (and the camera) at `t` ms — scrub/playhead. */
  const scrub = useCallback(
    (t: number) => {
      timeRef.current = t;
      setTimeMs(t);
      restoreCamera(sampleAnimV2(animRef.current, t, baseRef.current));
    },
    [restoreCamera],
  );

  /** Sets a key on all channels at time `t` (default: end of playback), from the view. */
  const insertKeyAtView = useCallback(
    (t?: number) => {
      const view = captureCamera();
      if (!view) return;
      const time = t != null ? Math.max(0, Math.round(t)) : Math.round(timeRef.current);
      if (!animHasAnimation(animRef.current)) baseRef.current = view;
      commit(upsertPoseAt(seedBase(view), time, view));
    },
    [captureCamera, commit, seedBase],
  );

  /** Adds a key on a specific channel (double-click on a curve in the graph editor). */
  const addKey = useCallback(
    (channel: ChannelId, t: number, v: number) => commit(upsertKey(seedBase(), channel, Math.max(0, t), v)),
    [commit, seedBase],
  );

  /**
   * Sets a key on **a single channel** at the playhead, from the current view (dopesheet row).
   * If the view does not carry the value (fov/roll absent from the capture), it falls back to the
   * channel's sampled value — setting a key then does not alter the curve. An EMPTY channel is
   * sampled from the base, never from zero: otherwise a focal key set on a new animation wrote 0°.
   */
  const insertChannelKeyAtView = useCallback(
    (channel: ChannelId, t?: number) => {
      const time = Math.max(0, Math.round(t ?? timeRef.current));
      const view = captureCamera();
      const next = seedBase(view);
      const fromView = view ? poseToChannelValues(view)[channel] : undefined;
      const fallback = baseChannelValues(animBase(next, baseRef.current))[channel];
      commit(upsertKey(next, channel, time, fromView ?? evalChannel(next.channels[channel], time, fallback)));
    },
    [captureCamera, commit, seedBase],
  );

  /** Retimes a dopesheet column live (drag of a diamond on the ruler). Live — call
   *  `beginStroke` at the start of the gesture for a single undo. */
  const strokeMoveColumn = useCallback((fromT: number, toT: number) => {
    const delta = Math.round(toT) - Math.round(fromT);
    if (delta !== 0) setAnimState(moveColumn(animRef.current, Math.round(fromT), delta));
  }, []);

  /** Removes all keys of a dopesheet column (Alt+click on a diamond). */
  const removeColumn = useCallback(
    (t: number) => commit(deleteColumn(animRef.current, Math.round(t))),
    [commit],
  );

  /** Applies a tangent profile to **a whole** curve (right-click on the channel row). */
  const applyChannelTangent = useCallback(
    (channel: ChannelId, type: TangentType, target?: TangentTarget) =>
      commit(setTangentType(animRef.current, channelRefs(animRef.current, channel), type, target)),
    [commit],
  );

  /** Extrapolation of a channel outside its keys (pre/post-infinity) — persisted with the animation. */
  const setExtrapolation = useCallback(
    (channel: ChannelId, patch: { pre?: Extrapolation; post?: Extrapolation }) =>
      commit(setChannelExtrapolation(animRef.current, channel, patch)),
    [commit],
  );

  /** Selects all keys of a curve (the tangent tools then apply to them). */
  const selectChannel = useCallback(
    (channel: ChannelId) => setSelection(channelRefs(animRef.current, channel)),
    [setSelection],
  );

  // Auto-key (Phase 27): any camera gesture sets a key from the view at the playback time.
  useCameraAutoKey(autoKey, getDom, insertKeyAtView);

  return {
    anim,
    setAnim,
    loop: anim.loop,
    setLoop,
    hasAnimation: animHasAnimation(anim),
    keyTimes: animKeyTimes(anim),
    duration: animDuration(anim),
    playDuration: animPlayDuration(anim),
    setDuration,
    playing,
    autoPaused,
    play,
    pause,
    scrub,
    timeMs,
    selection,
    setSelection,
    autoKey,
    setAutoKey,
    insertKeyAtView,
    addKey,
    insertChannelKeyAtView,
    strokeMoveColumn,
    removeColumn,
    applyTangentType,
    setSelectionBroken,
    setSelectionWeighted,
    applyChannelTangent,
    setExtrapolation,
    selectChannel,
    removeSelection,
    copySelection,
    paste,
    canPaste,
    beginStroke,
    strokeMoveKeys,
    strokeSetTangent,
    strokeUpsertAt,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  };
}

export type CameraAnimState = ReturnType<typeof useCameraAnim>;
