// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CameraAnimV2, ChannelId, KeyRef } from '../channels/model';
import { evalChannel } from '../channels/hermite';
import { CHANNEL_META, channelColor } from './channelMeta';
import CurveGrid from './CurveGrid';
import { inSel, useCurveGestures, type KeyMove } from './useCurveGestures';
import { timeToX, valueToY, xToTime, type TimeView, type ValueView } from './viewTransform';

const HANDLE_PX = 34; // longueur écran des poignées de tangente

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

/**
 * Graph editor F-curves (Phase 17/27) : grille de fond, une courbe par canal visible, ses clés en
 * points **déplaçables** (multi-sélection : rubber-band + Maj pour ajouter, déplacement groupé) et,
 * pour la clé primaire, des **poignées de tangente** draggables. Double-clic sur une courbe = ajouter
 * une clé ; molette = zoom temporel ; guide vertical = durée réglable. En lecture seule, l'édition
 * est inerte (playhead + affichage).
 *
 * Ce fichier ne porte que le **rendu et la composition** : les gestes (déplacement, rubber-band,
 * tangentes) vivent dans `useCurveGestures`.
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
  onMoveKeys: (baseline: CameraAnimV2, moves: KeyMove[]) => void;
  onSetTangent: (channel: ChannelId, index: number, patch: { tin?: number; tout?: number }) => void;
  onAddKey: (channel: ChannelId, t: number, v: number) => void;
}) {
  const tv: TimeView = { ...timeView, width };
  const vv: ValueView = { ...valueView, height };
  const primary = selection[selection.length - 1];

  const visibleChannels = CHANNEL_META.filter((c) => visible.has(c.id) && anim.channels[c.id]?.keys.length);

  const { svgRef, band, localX, surface, startKeyGesture, startTangentGesture } = useCurveGestures({
    anim,
    timeView: tv,
    valueView: vv,
    selection,
    editable,
    bandChannels: visibleChannels.map((c) => c.id),
    onScrub,
    onSelect,
    onBeginStroke,
    onMoveKeys,
    onSetTangent,
  });

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      className="min-w-0 flex-1 touch-none select-none"
      {...surface}
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
                              onPointerDown={(e) => startTangentGesture(e, side, c.id, i)}
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
                    onPointerDown={(e) => startKeyGesture(e, c.id, i)}
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
