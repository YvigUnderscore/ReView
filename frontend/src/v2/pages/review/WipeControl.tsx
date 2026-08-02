// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import { GripVertical, RotateCw } from 'lucide-react';
import { wipeAngleFromPoint, wipeCenter, wipePosFromPoint } from './wipe';
import type { useWipe } from './useWipe';

/**
 * Barre de wipe **visible et rotative** (comparaison A/B image & vidéo) : trait épais
 * contrasté, poignée centrale de déplacement (le long de la normale) et poignée de
 * rotation (le long de la barre). Double-clic sur la poignée centrale : réinitialise
 * (centre, vertical). À monter en `absolute inset-0` dans le conteneur du média.
 */
export default function WipeControl({ wipe }: { wipe: ReturnType<typeof useWipe> }) {
  const rootRef = useRef<HTMLDivElement>(null);
  // Rotation : le pivot est FIGÉ au début du drag (le centre courant de la barre) — sans
  // ça, le centre recalculé bouge avec l'angle et la rotation « part dans tous les sens ».
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
  // Poignée de rotation : le long de la barre, au-dessus du centre.
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
    // Rotation autour du pivot figé : nouvel angle depuis le pivot, puis `pos` recalculé
    // pour que la barre continue de passer PAR le pivot (elle tourne sur place).
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
    // Session live : manipuler le wipe vaut prise de main (co-pilote → driver).
    wipe.onGrab?.();
  };
  const release = () => (dragging.current = null);

  const handle =
    'pointer-events-auto absolute z-40 flex items-center justify-center rounded-full border-2 border-primary bg-card text-primary shadow-lg';

  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0 z-30 select-none overflow-hidden">
      {/* Barre : trait épais à double liseré, bien visible sur tout fond. */}
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
      {/* Poignée de déplacement (centre) */}
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
        title="Déplacer le wipe (double-clic : réinitialiser)"
      >
        <GripVertical size={15} />
      </div>
      {/* Poignée de rotation (sur la barre) */}
      <div
        className={`${handle} h-6 w-6 cursor-grab active:cursor-grabbing`}
        style={{ left: rotX - 12, top: rotY - 12 }}
        onPointerDown={grab('rotate')}
        onPointerMove={onPointerMove}
        onPointerUp={release}
        title="Faire pivoter la barre (aimanté à 0/45/90°)"
      >
        <RotateCw size={12} />
      </div>
      {/* Angle courant, affiché près de la poignée quand la barre n'est pas verticale */}
      {angle !== 0 && (
        <span
          className="absolute z-40 rounded bg-card/90 px-1 py-0.5 text-[10px] tabular-nums text-muted-foreground"
          style={{ left: rotX + 12, top: rotY - 8 }}
        >
          {Math.round(angle)}°
        </span>
      )}
    </div>
  );
}
