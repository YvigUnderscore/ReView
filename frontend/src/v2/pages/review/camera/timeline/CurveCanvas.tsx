import { useRef } from 'react';
import type { CameraAnimV2, ChannelId } from '../channels/model';
import { evalChannel } from '../channels/hermite';
import { CHANNEL_META, channelColor } from './channelMeta';
import { timeToX, valueToY, xToTime, yToValue, type TimeView, type ValueView } from './viewTransform';

const HANDLE_PX = 34; // longueur écran des poignées de tangente

interface Sel {
  channel: ChannelId;
  index: number;
}

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
 * Graph editor F-curves (Phase 17) : trace une courbe par canal visible, ses clés en points
 * **déplaçables** (x = temps, y = valeur) et, pour la clé sélectionnée, des **poignées de
 * tangente** draggables (mode `free`). Double-clic sur une courbe = ajouter une clé. Molette =
 * zoom temporel. En lecture seule, les interactions d'édition sont inertes (playhead + affichage).
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
  onZoom,
  onScrub,
  onSelect,
  onBeginStroke,
  onMoveKey,
  onSetTangent,
  onAddKey,
}: {
  anim: CameraAnimV2;
  visible: ReadonlySet<ChannelId>;
  timeView: TimeView;
  valueView: ValueView;
  playheadT: number;
  selection: Sel | null;
  editable: boolean;
  width: number;
  height: number;
  onZoom: (pivotT: number, factor: number) => void;
  onScrub: (t: number) => void;
  onSelect: (sel: Sel | null) => void;
  onBeginStroke: () => void;
  onMoveKey: (channel: ChannelId, index: number, patch: { t: number; v: number }) => void;
  onSetTangent: (channel: ChannelId, index: number, patch: { tin?: number; tout?: number }) => void;
  onAddKey: (channel: ChannelId, t: number, v: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ kind: 'key' | 'in' | 'out'; channel: ChannelId; index: number } | null>(null);
  const tv: TimeView = { ...timeView, width };
  const vv: ValueView = { ...valueView, height };

  const localX = (clientX: number) => clientX - (svgRef.current?.getBoundingClientRect().left ?? 0);
  const localY = (clientY: number) => clientY - (svgRef.current?.getBoundingClientRect().top ?? 0);

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const t = xToTime(localX(e.clientX), tv);
    const v = yToValue(localY(e.clientY), vv);
    const key = anim.channels[d.channel]?.keys[d.index];
    if (!key) return;
    if (d.kind === 'key') onMoveKey(d.channel, d.index, { t: Math.max(0, Math.round(t)), v });
    else {
      const dt = t - key.t;
      if (Math.abs(dt) < 1e-3) return;
      const slope = (v - key.v) / dt;
      onSetTangent(d.channel, d.index, d.kind === 'out' ? { tout: slope } : { tin: slope });
    }
  };

  const visibleChannels = CHANNEL_META.filter((c) => visible.has(c.id) && anim.channels[c.id]?.keys.length);

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      className="min-w-0 flex-1 touch-none select-none"
      onPointerMove={onMove}
      onPointerUp={(e) => {
        if (drag.current) (e.currentTarget as SVGElement).releasePointerCapture?.(e.pointerId);
        drag.current = null;
      }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onScrub(Math.max(0, xToTime(localX(e.clientX), tv)));
      }}
      onWheel={(e) => {
        onZoom(xToTime(localX(e.clientX), tv), e.deltaY < 0 ? 0.85 : 1.18);
      }}
    >
      {/* Playhead */}
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
              const isSel = selection?.channel === c.id && selection.index === i;
              return (
                <g key={i}>
                  {isSel && editable && (
                    <>
                      {(['in', 'out'] as const).map((side) => {
                        const dir = side === 'out' ? 1 : -1;
                        const slope = side === 'out' ? (k.tout ?? 0) : (k.tin ?? 0);
                        const hx = kx + dir * HANDLE_PX;
                        const tAtH = xToTime(hx, tv);
                        const hy = valueToY(k.v + slope * (tAtH - k.t), vv);
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
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      onSelect({ channel: c.id, index: i });
                      if (!editable) return;
                      onBeginStroke();
                      drag.current = { kind: 'key', channel: c.id, index: i };
                      (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
                    }}
                  />
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}
