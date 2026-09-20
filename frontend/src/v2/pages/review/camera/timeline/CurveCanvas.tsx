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
 * points **déplaçables** (multi-sélection : rubber-band + Maj pour ajouter, déplacement groupé,
 * snap à la frame) et, pour la clé primaire, des **poignées de tangente** draggables. Double-clic
 * sur une courbe = ajouter une clé. Navigation : molette = zoom temporel, **Ctrl+molette = zoom
 * vertical**, Maj+molette = pan temporel, **bouton du milieu = pan des deux axes**. Guide vertical =
 * durée réglable. En lecture seule, l'édition est inerte (playhead + affichage).
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
  /** Guide de durée de lecture (ms) — trait vertical repère (Phase 27). */
  guideT?: number;
  /** Framerate du pipeline : graduations de la grille et snap des clés déplacées. */
  fps: number;
  onZoom: (pivotT: number, factor: number) => void;
  /** Zoom vertical (Ctrl+molette) au pivot de valeur. */
  onZoomValue?: (pivotV: number, factor: number) => void;
  /** Pan horizontal (Maj+molette) — décale la fenêtre temporelle en ms. */
  onPan?: (deltaMs: number) => void;
  /** Pan des deux axes (bouton du milieu). */
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
        // Ctrl/Cmd+molette = zoom de l'axe des VALEURS (l'axe du temps garde la molette nue).
        if (onZoomValue && (e.ctrlKey || e.metaKey)) {
          onZoomValue(yToValue(localY(e.clientY), vv), factor);
          return;
        }
        // Maj+molette (ou molette horizontale de trackpad) = pan temporel ; sinon zoom au pivot.
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

      {/* Boîte de transformation : deux clés au moins, sinon il n'y a rien à mettre à l'échelle. */}
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
