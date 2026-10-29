// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef, useState } from 'react';
import type { CameraAnimV2, ChannelId, KeyRef } from '../channels/model';
import { keyBounds, scaleFactor, scaleKeyMoves, type KeyBounds } from '../channels/scaleKeys';
import { weightFromSpan, type TangentSide } from '../channels/tangents';
import type { ScaleGrip } from './TransformBox';
import {
  snapToFrame,
  timeToX,
  valueToY,
  xToTime,
  yToValue,
  type TimeView,
  type ValueView,
} from './viewTransform';

/** Below this, the rubber-band has not moved: the gesture counts as a simple click (scrub). */
const BAND_CLICK_PX = 3;
/** Under this time gap, a tangent slope is meaningless (unstable division). */
const MIN_SLOPE_DT = 1e-3;
/** Under this distance to the pivot, a scale factor is meaningless (one frame in time). */
const MIN_SCALE_DT = 1;

/** Origin of a grouped move: key (channel+index) and its starting values (baseline). */
interface KeyOrigin {
  channel: ChannelId;
  index: number;
  t0: number;
  v0: number;
}

/** Tangent side being manipulated — the canonical type lives with its semantics (`channels/tangents`). */
export type { TangentSide };

/** Rubber-band rectangle, in local SVG pixels. */
export interface BandRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Grouped move requested from the model (recomputed from the baseline on every frame of the gesture). */
export interface KeyMove {
  channel: ChannelId;
  index: number;
  t: number;
  v: number;
}

/**
 * Gesture in progress. Deliberately open union: an upcoming gesture (transform box, vertical zoom
 * on drag, pre/post-infinity handles) is added here and in `onPointerMove`, without touching the
 * canvas rendering.
 */
type DragState =
  | { kind: 'keys'; baseline: CameraAnimV2; tDown: number; vDown: number; origins: KeyOrigin[] }
  | {
      kind: 'scale';
      baseline: CameraAnimV2;
      refs: readonly KeyRef[];
      grip: ScaleGrip;
      pivotT: number;
      pivotV: number;
      fromT: number;
      fromV: number;
    }
  | { kind: 'tangent'; side: TangentSide; channel: ChannelId; index: number }
  | { kind: 'pan'; x: number; y: number }
  | { kind: 'band'; x0: number; y0: number };

/** Does a key (channel + index) belong to the selection? */
export const inSel = (sel: readonly KeyRef[], id: ChannelId, i: number) =>
  sel.some((s) => s.channel === id && s.index === i);

/** Model outputs called by the gestures — the state lives in `useCameraAnim`. */
export interface CurveGestureCallbacks {
  onScrub: (t: number) => void;
  onSelect: (sel: KeyRef[]) => void;
  onBeginStroke: () => void;
  onMoveKeys: (baseline: CameraAnimV2, moves: KeyMove[]) => void;
  /** Slope (and weight, if the key is weighted) of a tangent side — see `setTangentSlope`. */
  onSetTangent: (
    channel: ChannelId,
    index: number,
    side: TangentSide,
    slope: number,
    weight?: number,
  ) => void;
  /** View pan on the middle button (time in ms, value in channel units). */
  onPanView?: (deltaMs: number, deltaV: number) => void;
}

/**
 * F-curve graph editor gestures (Phase 17/27): grouped key move, rubber-band selection and
 * tangent handle manipulation. The canvas only keeps the rendering and wires up the returned
 * surfaces.
 *
 * Two pitfalls this hook handles:
 * - the **baseline** (animation at pointerdown) is captured once and replayed on every frame: the
 *   key indices stay consistent throughout the move (Phase 27);
 * - the **pointer capture** is set on the element that received the pointerdown (key, handle or
 *   background), otherwise a gesture released outside the frame stays stuck to the pointer.
 */
export function useCurveGestures(
  opts: {
    anim: CameraAnimV2;
    timeView: TimeView;
    valueView: ValueView;
    selection: readonly KeyRef[];
    editable: boolean;
    /** Drawn channels: target of the rubber-band (a hidden channel cannot be selected). */
    bandChannels: readonly ChannelId[];
    /** Pipeline frame rate: moved keys land ON a frame (Alt to release). */
    fps: number;
  } & CurveGestureCallbacks,
) {
  const { anim, timeView: tv, valueView: vv, selection, editable, bandChannels, fps } = opts;
  const { onScrub, onSelect, onBeginStroke, onMoveKeys, onSetTangent, onPanView } = opts;
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<DragState | null>(null);
  const [band, setBand] = useState<BandRect | null>(null);

  const localX = (clientX: number) => clientX - (svgRef.current?.getBoundingClientRect().left ?? 0);
  const localY = (clientY: number) => clientY - (svgRef.current?.getBoundingClientRect().top ?? 0);
  const capture = (e: React.PointerEvent) => (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);

  /**
   * Tangent: slope = (pointer v − key v) / (pointer t − key t), applied to the dragged side. On a
   * **weighted** key, the pointer distance also sets the handle length (weight) — that is the whole
   * point of a weighted tangent.
   */
  const dragTangent = (d: Extract<DragState, { kind: 'tangent' }>, e: React.PointerEvent) => {
    const keys = anim.channels[d.channel]?.keys;
    const key = keys?.[d.index];
    if (!keys || !key) return;
    const deltaT = xToTime(localX(e.clientX), tv) - key.t;
    if (Math.abs(deltaT) < MIN_SLOPE_DT) return;
    const slope = (yToValue(localY(e.clientY), vv) - key.v) / deltaT;
    const weighted = (d.side === 'in' ? key.wIn : key.wOut) != null;
    const weight = weighted ? weightFromSpan(keys, d.index, d.side, deltaT) : null;
    onSetTangent(d.channel, d.index, d.side, slope, weight ?? undefined);
  };

  /** Time of a moved key: on a frame, except with Alt (same rule as scrubbing). */
  const timeOf = (t: number, free: boolean) => (free ? Math.max(0, t) : snapToFrame(t, fps));

  /**
   * Live scaling: each grabbed axis takes the ratio of the distances to the pivot (the opposite
   * edge), the others stay at 1. Goes through `onMoveKeys` — hence through the drag baseline and
   * the gesture's single undo, like an ordinary move.
   */
  const dragScale = (d: Extract<DragState, { kind: 'scale' }>, e: React.PointerEvent) => {
    const onTime = d.grip === 'left' || d.grip === 'right' || d.grip === 'corner';
    const onValue = d.grip === 'top' || d.grip === 'bottom' || d.grip === 'corner';
    const toT = xToTime(localX(e.clientX), tv);
    const toV = yToValue(localY(e.clientY), vv);
    const scaleT = onTime ? scaleFactor(d.fromT, toT, d.pivotT, MIN_SCALE_DT) : 1;
    const valueEpsilon = Math.abs(vv.v1 - vv.v0) * 1e-3;
    const scaleV = onValue ? scaleFactor(d.fromV, toV, d.pivotV, valueEpsilon) : 1;
    onMoveKeys(
      d.baseline,
      scaleKeyMoves(d.baseline, d.refs, {
        pivotT: d.pivotT,
        scaleT,
        pivotV: d.pivotV,
        scaleV,
        snapTime: (t) => timeOf(t, e.altKey),
      }),
    );
  };

  /** Keys contained in the rectangle; `additive` adds to the current selection (Shift). */
  const commitBand = (rect: BandRect, additive: boolean) => {
    const xMin = Math.min(rect.x0, rect.x1);
    const xMax = Math.max(rect.x0, rect.x1);
    const yMin = Math.min(rect.y0, rect.y1);
    const yMax = Math.max(rect.y0, rect.y1);
    const picked: KeyRef[] = [];
    for (const id of bandChannels) {
      anim.channels[id]?.keys.forEach((k, i) => {
        const x = timeToX(k.t, tv);
        const y = valueToY(k.v, vv);
        if (x >= xMin && x <= xMax && y >= yMin && y <= yMax) picked.push({ channel: id, index: i });
      });
    }
    onSelect(
      additive ? [...selection, ...picked.filter((p) => !inSel(selection, p.channel, p.index))] : picked,
    );
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'band') {
      setBand({ x0: d.x0, y0: d.y0, x1: localX(e.clientX), y1: localY(e.clientY) });
      return;
    }
    if (d.kind === 'pan') {
      // The view follows the pointer: the window therefore moves in reverse in time.
      const x = localX(e.clientX);
      const y = localY(e.clientY);
      const deltaMs = (-(x - d.x) / (tv.width || 1)) * (tv.t1 - tv.t0);
      const deltaV = ((y - d.y) / (vv.height || 1)) * (vv.v1 - vv.v0);
      onPanView?.(deltaMs, deltaV);
      d.x = x;
      d.y = y;
      return;
    }
    if (d.kind === 'scale') {
      dragScale(d, e);
      return;
    }
    if (d.kind === 'keys') {
      const dt = xToTime(localX(e.clientX), tv) - d.tDown;
      const dv = yToValue(localY(e.clientY), vv) - d.vDown;
      // Frame snap like the scrub and the column retime — Alt releases the placement.
      const timeAt = (t0: number) => timeOf(t0 + dt, e.altKey);
      onMoveKeys(
        d.baseline,
        d.origins.map((o) => ({ channel: o.channel, index: o.index, t: timeAt(o.t0), v: o.v0 + dv })),
      );
      return;
    }
    dragTangent(d, e);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d?.kind === 'band') {
      const x1 = localX(e.clientX);
      const y1 = localY(e.clientY);
      if (Math.hypot(x1 - d.x0, y1 - d.y0) > BAND_CLICK_PX)
        commitBand({ x0: d.x0, y0: d.y0, x1, y1 }, e.shiftKey);
      else onScrub(Math.max(0, xToTime(d.x0, tv)));
    }
    if (drag.current) (e.currentTarget as SVGElement).releasePointerCapture?.(e.pointerId);
    drag.current = null;
    setBand(null);
  };

  /**
   * Middle button: pans the view, wherever the pointer is (usage of all curve editors).
   * Left button on the graph **background** (`target === currentTarget`): rubber-band.
   */
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 1 && onPanView) {
      e.preventDefault();
      drag.current = { kind: 'pan', x: localX(e.clientX), y: localY(e.clientY) };
      capture(e);
      return;
    }
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    drag.current = { kind: 'band', x0: localX(e.clientX), y0: localY(e.clientY) };
    capture(e);
  };

  /** Click on a key: updates the selection (Shift = toggle) then arms the grouped move. */
  const startKeyGesture = (e: React.PointerEvent, id: ChannelId, i: number) => {
    // The middle button belongs to the pan: it must bubble up to the surface.
    if (e.button !== 0) return;
    e.stopPropagation();
    const already = inSel(selection, id, i);
    let next: KeyRef[];
    if (e.shiftKey)
      next = already
        ? selection.filter((s) => !(s.channel === id && s.index === i))
        : [...selection, { channel: id, index: i }];
    else next = already ? [...selection] : [{ channel: id, index: i }];
    onSelect(next);
    if (!editable || (e.shiftKey && already)) return;
    const origins: KeyOrigin[] = [];
    for (const s of next) {
      const k = anim.channels[s.channel]?.keys[s.index];
      if (k) origins.push({ channel: s.channel, index: s.index, t0: k.t, v0: k.v });
    }
    onBeginStroke();
    drag.current = {
      kind: 'keys',
      baseline: anim,
      tDown: xToTime(localX(e.clientX), tv),
      vDown: yToValue(localY(e.clientY), vv),
      origins,
    };
    capture(e);
  };

  /**
   * Click on a handle of the transform box: the opposite edge becomes the pivot, and the gesture
   * scales the selection until release.
   */
  const startScaleGesture = (e: React.PointerEvent, grip: ScaleGrip, bounds: KeyBounds) => {
    if (e.button !== 0 || !editable) return;
    e.stopPropagation();
    onBeginStroke();
    drag.current = {
      kind: 'scale',
      baseline: anim,
      refs: [...selection],
      grip,
      pivotT: grip === 'left' ? bounds.tMax : bounds.tMin,
      pivotV: grip === 'bottom' ? bounds.vMax : bounds.vMin,
      fromT: xToTime(localX(e.clientX), tv),
      fromV: yToValue(localY(e.clientY), vv),
    };
    capture(e);
  };

  /** Click on a tangent handle: arms the gesture on the `in` or `out` side of the primary key. */
  const startTangentGesture = (e: React.PointerEvent, side: TangentSide, id: ChannelId, i: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onBeginStroke();
    drag.current = { kind: 'tangent', side, channel: id, index: i };
    capture(e);
  };

  return {
    svgRef,
    /** Rubber-band in progress (to be drawn by the canvas), `null` outside a gesture. */
    band,
    localX,
    localY,
    /** To be wired as is onto the graph's `<svg>`. */
    surface: { onPointerDown, onPointerMove, onPointerUp },
    startKeyGesture,
    startTangentGesture,
    startScaleGesture,
    /** Extent of the selection (transform box), `null` if it designates nothing. */
    selectionBounds: keyBounds(anim, selection),
  };
}
