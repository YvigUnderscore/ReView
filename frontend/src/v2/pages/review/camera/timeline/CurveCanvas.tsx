// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CameraAnimV2, ChannelId, KeyRef } from '../channels/model';
import { evalChannel } from '../channels/hermite';
import type { TangentSide } from '../channels/tangents';
import { CHANNEL_META, channelColor } from './channelMeta';
import CurveGrid from './CurveGrid';
import TangentHandles from './TangentHandles';
import TransformBox from './TransformBox';
import { inSel, useCurveGestures, type KeyMove } from './useCurveGestures';
import { timeToX, valueToY, xToTime, yToValue, type TimeView, type ValueView } from './viewTransform';

/** Points of an F-curve sampled over the visible window (SVG polyline). */
function curvePath(anim: CameraAnimV2, id: ChannelId, tv: TimeView, vv: ValueView): string {
  const ch = anim.channels[id];
  if (!ch?.keys.length) return '';
  const steps = Math.max(2, Math.min(240, Math.round(tv.width / 3)));
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = tv.t0 + (i / steps) * (tv.t1 - tv.t0);
    pts.push(`${timeToX(t, tv).toFixed(1)},${valueToY(evalChannel(ch, t, 0), vv).toFixed(1)}`);
  }
  return `M${pts.join(' L')}`;
}

/**
 * F-curve graph editor (Phase 17/27): background grid, one curve per visible channel, its keys as
 * **movable** points (multi-selection: rubber-band + Shift to add, grouped move, frame snap) and,
 * for the primary key, draggable **tangent handles**. Double-clicking a curve adds a key.
 * Navigation: wheel = time zoom, **Ctrl+wheel = vertical zoom**, Shift+wheel = time pan,
 * **middle button = pan on both axes**. Vertical guide = adjustable duration. Read-only: editing
 * is inert (playhead + display).
 *
 * This file only holds the **rendering and composition**: the gestures (move, rubber-band,
 * tangents) live in `useCurveGestures`.
 */
export default function CurveCanvas({
  anim,
  visible,
  timeView,
  valueView,
  playheadT,
  selection,
  editable,
  width,
  height,
  guideT,
  fps,
  onZoom,
  onZoomValue,
  onPan,
  onPanView,
  onScrub,
  onSelect,
  onBeginStroke,
  onMoveKeys,
  onSetTangent,
  onAddKey,
}: {
  anim: CameraAnimV2;
  visible: ReadonlySet<ChannelId>;
  timeView: TimeView;
  valueView: ValueView;
  playheadT: number;
  selection: readonly KeyRef[];
  editable: boolean;
  width: number;
  height: number;
  /** Playback duration guide (ms) — vertical reference line (Phase 27). */
  guideT?: number;
  /** Pipeline frame rate: grid ticks and snapping of moved keys. */
  fps: number;
  onZoom: (pivotT: number, factor: number) => void;
  /** Vertical zoom (Ctrl+wheel) around the value pivot. */
  onZoomValue?: (pivotV: number, factor: number) => void;
  /** Horizontal pan (Shift+wheel) — shifts the time window in ms. */
  onPan?: (deltaMs: number) => void;
  /** Pan on both axes (middle button). */
  onPanView?: (deltaMs: number, deltaV: number) => void;
  onScrub: (t: number) => void;
  onSelect: (sel: KeyRef[]) => void;
  onBeginStroke: () => void;
  onMoveKeys: (baseline: CameraAnimV2, moves: KeyMove[]) => void;
  onSetTangent: (
    channel: ChannelId,
    index: number,
    side: TangentSide,
    slope: number,
    weight?: number,
  ) => void;
  onAddKey: (channel: ChannelId, t: number, v: number) => void;
}) {
  const tv: TimeView = { ...timeView, width };
  const vv: ValueView = { ...valueView, height };
  const primary = selection[selection.length - 1];

  const visibleChannels = CHANNEL_META.filter((c) => visible.has(c.id) && anim.channels[c.id]?.keys.length);

  const {
    svgRef,
    band,
    localX,
    localY,
    surface,
    startKeyGesture,
    startTangentGesture,
    startScaleGesture,
    selectionBounds,
  } = useCurveGestures({
    anim,
    timeView: tv,
    valueView: vv,
    selection,
    editable,
    fps,
    bandChannels: visibleChannels.map((c) => c.id),
    onScrub,
    onSelect,
    onBeginStroke,
    onMoveKeys,
    onSetTangent,
    onPanView,
  });

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      className="min-w-0 flex-1 touch-none select-none"
      {...surface}
      onWheel={(e) => {
        const factor = e.deltaY < 0 ? 0.85 : 1.18;
        // Ctrl/Cmd+wheel = zoom on the VALUE axis (the time axis keeps the bare wheel).
        if (onZoomValue && (e.ctrlKey || e.metaKey)) {
          onZoomValue(yToValue(localY(e.clientY), vv), factor);
          return;
        }
        // Shift+wheel (or trackpad horizontal wheel) = time pan; otherwise zoom around the pivot.
        const horiz = e.shiftKey ? e.deltaY : e.deltaX;
        if (onPan && horiz !== 0 && (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)))
          onPan((horiz / (tv.width || 1)) * (tv.t1 - tv.t0));
        else onZoom(xToTime(localX(e.clientX), tv), factor);
      }}
    >
      <CurveGrid timeView={timeView} valueView={valueView} width={width} height={height} fps={fps} />

      {guideT != null && guideT > 0 && (
        <line
          x1={timeToX(guideT, tv)}
          x2={timeToX(guideT, tv)}
          y1={0}
          y2={height}
          stroke="hsl(var(--muted-foreground))"
          strokeWidth={1}
          strokeDasharray="4 3"
          opacity={0.7}
        />
      )}

      <line
        x1={timeToX(playheadT, tv)}
        x2={timeToX(playheadT, tv)}
        y1={0}
        y2={height}
        stroke="hsl(var(--primary))"
        strokeWidth={1}
      />

      {visibleChannels.map((c) => {
        const keys = anim.channels[c.id]!.keys;
        const color = channelColor(c.colorVar);
        return (
          <g key={c.id}>
            <path
              d={curvePath(anim, c.id, tv, vv)}
              fill="none"
              stroke={color}
              strokeWidth={1.5}
              onDoubleClick={(e) => {
                if (!editable) return;
                const t = xToTime(localX(e.clientX), tv);
                onAddKey(c.id, Math.max(0, Math.round(t)), evalChannel(anim.channels[c.id], t, 0));
              }}
              style={{ cursor: editable ? 'copy' : 'default' }}
            />
            {keys.map((k, i) => {
              const kx = timeToX(k.t, tv);
              const ky = valueToY(k.v, vv);
              const isSel = inSel(selection, c.id, i);
              const isPrimary = primary?.channel === c.id && primary.index === i;
              return (
                <g key={i}>
                  {isPrimary && editable && (
                    <TangentHandles
                      keys={keys}
                      index={i}
                      color={color}
                      timeView={tv}
                      valueView={vv}
                      onStart={(e, side) => startTangentGesture(e, side, c.id, i)}
                    />
                  )}
                  <circle
                    cx={kx}
                    cy={ky}
                    r={isSel ? 5 : 4}
                    fill={isSel ? color : 'hsl(var(--card))'}
                    stroke={color}
                    strokeWidth={1.5}
                    style={{ cursor: editable ? 'move' : 'pointer' }}
                    onPointerDown={(e) => startKeyGesture(e, c.id, i)}
                  />
                </g>
              );
            })}
          </g>
        );
      })}

      {/* Transform box: at least two keys, otherwise there is nothing to scale. */}
      {editable && selection.length > 1 && selectionBounds && (
        <TransformBox
          bounds={selectionBounds}
          timeView={tv}
          valueView={vv}
          onGrip={(e, grip) => startScaleGesture(e, grip, selectionBounds)}
        />
      )}

      {band && (
        <rect
          x={Math.min(band.x0, band.x1)}
          y={Math.min(band.y0, band.y1)}
          width={Math.abs(band.x1 - band.x0)}
          height={Math.abs(band.y1 - band.y0)}
          fill="hsl(var(--primary))"
          fillOpacity={0.12}
          stroke="hsl(var(--primary))"
          strokeWidth={1}
        />
      )}
    </svg>
  );
}
