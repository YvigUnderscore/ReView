// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import { GripVertical, RotateCw } from 'lucide-react';
import { wipeAngleFromPoint, wipeCenter, wipePosFromPoint } from './wipe';
import type { useWipe } from './useWipe';
import { useT } from '../../i18n';

/**
 * **Visible and rotatable** wipe bar (A/B image & video comparison): a thick, high-contrast
 * line, a central move handle (along the normal) and a rotation handle (along the bar).
 * Double-click the central handle: resets (center, vertical). Mount it as `absolute inset-0`
 * in the media container.
 */
export default function WipeControl({ wipe }: { wipe: ReturnType<typeof useWipe> }) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  // Rotation: the pivot is FROZEN at the start of the drag (the bar's current center) — without
  // it, the recomputed center moves with the angle and the rotation "goes in all directions".
  const dragging = useRef<{ mode: 'move' | 'rotate'; pivot: [number, number] } | null>(null);
  const { pos, setPos, angle, setAngle, size, setSize } = wipe;

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [setSize]);

  const [cx, cy] = wipeCenter(pos, angle, size.w || 1, size.h || 1);
  // Rotation handle: along the bar, above the center.
  const rotDist = Math.min(90, Math.max(50, size.h * 0.18));
  const a = (angle * Math.PI) / 180;
  const rotX = cx + Math.sin(a) * rotDist;
  const rotY = cy - Math.cos(a) * rotDist;

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragging.current;
    const rect = rootRef.current?.getBoundingClientRect();
    if (!d || !rect) return;
    const x = e.clientX - rect.left,
      y = e.clientY - rect.top;
    if (d.mode === 'move') {
      setPos(wipePosFromPoint(x, y, angle, rect.width, rect.height));
      return;
    }
    // Rotation around the frozen pivot: new angle from the pivot, then `pos` recomputed
    // so that the bar keeps passing THROUGH the pivot (it rotates in place).
    const [pvx, pvy] = d.pivot;
    const nextAngle = wipeAngleFromPoint(x, y, pvx, pvy);
    setAngle(nextAngle);
    setPos(wipePosFromPoint(pvx, pvy, nextAngle, rect.width, rect.height));
  };
  const grab = (mode: 'move' | 'rotate') => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragging.current = { mode, pivot: [cx, cy] };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    // Live session: manipulating the wipe counts as taking over (co-pilot → driver).
    wipe.onGrab?.();
  };
  const release = () => (dragging.current = null);

  const handle =
    'pointer-events-auto absolute z-40 flex items-center justify-center rounded-full border-2 border-primary bg-card text-primary shadow-lg';

  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0 z-30 select-none overflow-hidden">
      {/* Bar: thick line with a double border, clearly visible on any background. */}
      <div
        className="absolute"
        style={{
          left: cx,
          top: cy,
          width: 4,
          height: Math.hypot(size.w, size.h) * 2,
          transform: `translate(-50%, -50%) rotate(${angle}deg)`,
          background: 'hsl(var(--primary))',
          boxShadow: '0 0 0 1.5px rgba(0,0,0,0.65), 0 0 10px rgba(0,0,0,0.5)',
        }}
      />
      {/* Move handle (center) */}
      <div
        className={`${handle} h-8 w-8 cursor-ew-resize`}
        style={{ left: cx - 16, top: cy - 16 }}
        onPointerDown={grab('move')}
        onPointerMove={onPointerMove}
        onPointerUp={release}
        onDoubleClick={() => {
          setPos(0.5);
          setAngle(0);
        }}
        title={t('review.wipe.move')}
      >
        <GripVertical size={15} />
      </div>
      {/* Rotation handle (on the bar) */}
      <div
        className={`${handle} h-6 w-6 cursor-grab active:cursor-grabbing`}
        style={{ left: rotX - 12, top: rotY - 12 }}
        onPointerDown={grab('rotate')}
        onPointerMove={onPointerMove}
        onPointerUp={release}
        title={t('review.wipe.rotate')}
      >
        <RotateCw size={12} />
      </div>
      {/* Current angle, shown near the handle when the bar is not vertical */}
      {angle !== 0 && (
        <span
          className="absolute z-40 rounded bg-card/90 px-1 py-0.5 text-2xs tabular-nums text-muted-foreground"
          style={{ left: rotX + 12, top: rotY - 8 }}
        >
          {Math.round(angle)}°
        </span>
      )}
    </div>
  );
}
