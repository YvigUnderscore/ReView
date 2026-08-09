// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef, useState } from 'react';
import type { CameraAnimV2, ChannelId, KeyRef } from '../channels/model';
import { evalChannel } from '../channels/hermite';
import { CHANNEL_META, channelColor } from './channelMeta';
import CurveGrid from './CurveGrid';
import { timeToX, valueToY, xToTime, yToValue, type TimeView, type ValueView } from './viewTransform';

const HANDLE_PX = 34; // longueur écran des poignées de tangente

/** Origine d'un déplacement groupé : clé (canal+index) et ses valeurs de départ (baseline). */
interface KeyOrigin {
  channel: ChannelId;
  index: number;
  t0: number;
  v0: number;
}

type DragState =
  | { kind: 'keys'; baseline: CameraAnimV2; tDown: number; vDown: number; origins: KeyOrigin[] }
  | { kind: 'in' | 'out'; channel: ChannelId; index: number }
  | { kind: 'band'; x0: number; y0: number };

/** Points d'une F-curve échantillonnée sur la fenêtre visible (polyline SVG). */
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

const inSel = (sel: readonly KeyRef[], id: ChannelId, i: number) =>
  sel.some((s) => s.channel === id && s.index === i);

/**
 * Graph editor F-curves (Phase 17/27) : grille de fond, une courbe par canal visible, ses clés en
 * points **déplaçables** (multi-sélection : rubber-band + Maj pour ajouter, déplacement groupé) et,
 * pour la clé primaire, des **poignées de tangente** draggables. Double-clic sur une courbe = ajouter
 * une clé ; molette = zoom temporel ; guide vertical = durée réglable. En lecture seule, l'édition
 * est inerte (playhead + affichage).
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
  onZoom,
  onPan,
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
  /** Guide de durée de lecture (ms) — trait vertical repère (Phase 27). */
  guideT?: number;
  onZoom: (pivotT: number, factor: number) => void;
  /** Pan horizontal (Maj+molette) — décale la fenêtre temporelle en ms. */
  onPan?: (deltaMs: number) => void;
  onScrub: (t: number) => void;
  onSelect: (sel: KeyRef[]) => void;
  onBeginStroke: () => void;
  onMoveKeys: (
    baseline: CameraAnimV2,
    moves: Array<{ channel: ChannelId; index: number; t: number; v: number }>,
  ) => void;
  onSetTangent: (channel: ChannelId, index: number, patch: { tin?: number; tout?: number }) => void;
  onAddKey: (channel: ChannelId, t: number, v: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<DragState | null>(null);
  const [band, setBand] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const tv: TimeView = { ...timeView, width };
  const vv: ValueView = { ...valueView, height };
  const primary = selection[selection.length - 1];

  const localX = (clientX: number) => clientX - (svgRef.current?.getBoundingClientRect().left ?? 0);
  const localY = (clientY: number) => clientY - (svgRef.current?.getBoundingClientRect().top ?? 0);

  const visibleChannels = CHANNEL_META.filter((c) => visible.has(c.id) && anim.channels[c.id]?.keys.length);

  /** Démarre un déplacement groupé depuis la sélection `sel` (baseline = animation courante). */
  const startKeyDrag = (sel: readonly KeyRef[], e: React.PointerEvent) => {
    const origins: KeyOrigin[] = [];
    for (const s of sel) {
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
    (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
  };

  const onKeyPointerDown = (e: React.PointerEvent, id: ChannelId, i: number) => {
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
    startKeyDrag(next, e);
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'band') {
      setBand({ x0: d.x0, y0: d.y0, x1: localX(e.clientX), y1: localY(e.clientY) });
      return;
    }
    if (d.kind === 'keys') {
      const dt = xToTime(localX(e.clientX), tv) - d.tDown;
      const dv = yToValue(localY(e.clientY), vv) - d.vDown;
      onMoveKeys(
        d.baseline,
        d.origins.map((o) => ({ channel: o.channel, index: o.index, t: o.t0 + dt, v: o.v0 + dv })),
      );
      return;
    }
    // Tangente (poignée) de la clé primaire.
    const key = anim.channels[d.channel]?.keys[d.index];
    if (!key) return;
    const t = xToTime(localX(e.clientX), tv);
    const v = yToValue(localY(e.clientY), vv);
    const deltaT = t - key.t;
    if (Math.abs(deltaT) < 1e-3) return;
    const slope = (v - key.v) / deltaT;
    onSetTangent(d.channel, d.index, d.kind === 'out' ? { tout: slope } : { tin: slope });
  };

  const commitBand = (rect: { x0: number; y0: number; x1: number; y1: number }, additive: boolean) => {
    const xMin = Math.min(rect.x0, rect.x1);
    const xMax = Math.max(rect.x0, rect.x1);
    const yMin = Math.min(rect.y0, rect.y1);
    const yMax = Math.max(rect.y0, rect.y1);
    const picked: KeyRef[] = [];
    for (const c of visibleChannels) {
      anim.channels[c.id]!.keys.forEach((k, i) => {
        const x = timeToX(k.t, tv);
        const y = valueToY(k.v, vv);
        if (x >= xMin && x <= xMax && y >= yMin && y <= yMax) picked.push({ channel: c.id, index: i });
      });
    }
    onSelect(
      additive ? [...selection, ...picked.filter((p) => !inSel(selection, p.channel, p.index))] : picked,
    );
  };

  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d?.kind === 'band') {
      const moved = Math.hypot(localX(e.clientX) - d.x0, localY(e.clientY) - d.y0) > 3;
      if (moved) commitBand({ x0: d.x0, y0: d.y0, x1: localX(e.clientX), y1: localY(e.clientY) }, e.shiftKey);
      else onScrub(Math.max(0, xToTime(d.x0, tv)));
    }
    if (drag.current) (e.currentTarget as SVGElement).releasePointerCapture?.(e.pointerId);
    drag.current = null;
    setBand(null);
  };

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      className="min-w-0 flex-1 touch-none select-none"
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerDown={(e) => {
        if (e.target !== e.currentTarget) return;
        drag.current = { kind: 'band', x0: localX(e.clientX), y0: localY(e.clientY) };
        (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
      }}
      onWheel={(e) => {
        // Maj+molette (ou molette horizontale de trackpad) = pan temporel ; sinon zoom au pivot.
        const horiz = e.shiftKey ? e.deltaY : e.deltaX;
        if (onPan && horiz !== 0 && (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)))
          onPan((horiz / (tv.width || 1)) * (tv.t1 - tv.t0));
        else onZoom(xToTime(localX(e.clientX), tv), e.deltaY < 0 ? 0.85 : 1.18);
      }}
    >
      <CurveGrid timeView={timeView} valueView={valueView} width={width} height={height} />

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
                    <>
                      {(['in', 'out'] as const).map((side) => {
                        const dir = side === 'out' ? 1 : -1;
                        const slope = side === 'out' ? (k.tout ?? 0) : (k.tin ?? 0);
                        const hx = kx + dir * HANDLE_PX;
                        const hy = valueToY(k.v + slope * (xToTime(hx, tv) - k.t), vv);
                        return (
                          <g key={side}>
                            <line
                              x1={kx}
                              y1={ky}
                              x2={hx}
                              y2={hy}
                              stroke={color}
                              strokeWidth={1}
                              opacity={0.6}
                            />
                            <circle
                              cx={hx}
                              cy={hy}
                              r={3.5}
                              fill="hsl(var(--card))"
                              stroke={color}
                              strokeWidth={1.5}
                              style={{ cursor: 'move' }}
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                onBeginStroke();
                                drag.current = { kind: side, channel: c.id, index: i };
                                (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
                              }}
                            />
                          </g>
                        );
                      })}
                    </>
                  )}
                  <circle
                    cx={kx}
                    cy={ky}
                    r={isSel ? 5 : 4}
                    fill={isSel ? color : 'hsl(var(--card))'}
                    stroke={color}
                    strokeWidth={1.5}
                    style={{ cursor: editable ? 'move' : 'pointer' }}
                    onPointerDown={(e) => onKeyPointerDown(e, c.id, i)}
                  />
                </g>
              );
            })}
          </g>
        );
      })}

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
