// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import { clampPipRect, defaultPipRect, type PipRect } from './pipWindow';
import { useT } from '../../../i18n';

/**
 * Fenêtre flottante du PiP (mode layout, Phase 27) : cadre DOM **déplaçable** (drag sur le cadre)
 * et **redimensionnable** (poignée haut-gauche, coin bas-droit ancré, aspect verrouillé = cadre
 * de la caméra). Le rendu WebGL est dessiné dessous en scissor : chaque changement de rect est
 * remonté via `onRect` (px CSS, origine haut-gauche du conteneur ; `null` au démontage).
 * Positionné impérativement (ref) — aucun re-render pendant le drag.
 *
 * Le rect est **retenu pour la session** (variable de module) : rouvrir le PiP le remet où on
 * l'avait laissé. **Double-clic** : agrandit la vue caméra (≈ ¾ du viewport), re-double-clic la
 * ramène à sa taille d'avant.
 */

// Dernier rect utilisé (session) — partagé entre montages successifs du PiP.
let sessionRect: PipRect | null = null;
export default function PipFrame({
  label,
  aspect,
  onRect,
}: {
  label: string;
  /** Aspect du cadre de la caméra (la fenêtre le conserve en se redimensionnant). */
  aspect: number;
  onRect: (rect: PipRect | null) => void;
}) {
  const t = useT();
  const frameRef = useRef<HTMLDivElement>(null);
  const rectRef = useRef<PipRect | null>(null);
  // Dernières props lues par les listeners (installés une seule fois).
  const aspectRef = useRef(aspect);
  const onRectRef = useRef(onRect);
  useEffect(() => {
    aspectRef.current = aspect;
    onRectRef.current = onRect;
  }, [aspect, onRect]);

  useEffect(() => {
    const frame = frameRef.current;
    const parent = frame?.parentElement;
    if (!frame || !parent) return;

    const apply = (rect: PipRect) => {
      rectRef.current = rect;
      sessionRect = rect;
      frame.style.left = `${rect.x}px`;
      frame.style.top = `${rect.y}px`;
      frame.style.width = `${rect.w}px`;
      frame.style.height = `${rect.h}px`;
      onRectRef.current(rect);
    };
    apply(
      sessionRect
        ? clampPipRect(sessionRect, parent.clientWidth, parent.clientHeight, aspectRef.current)
        : defaultPipRect(parent.clientWidth, parent.clientHeight, aspectRef.current),
    );

    // Le conteneur change de taille (fenêtre, plein écran) → la fenêtre reste dans les bords.
    const ro = new ResizeObserver(() => {
      const r = rectRef.current;
      if (r) apply(clampPipRect(r, parent.clientWidth, parent.clientHeight, aspectRef.current));
    });
    ro.observe(parent);

    // Drag : déplacer (cadre) ou redimensionner (poignée — coin bas-droit ancré).
    let drag: { mode: 'move' | 'resize'; startX: number; startY: number; start: PipRect } | null = null;
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 || !rectRef.current) return;
      const resize = (e.target as HTMLElement).dataset.pipResize != null;
      drag = {
        mode: resize ? 'resize' : 'move',
        startX: e.clientX,
        startY: e.clientY,
        start: rectRef.current,
      };
      frame.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!drag) return;
      const { start } = drag;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      const next =
        drag.mode === 'move'
          ? { ...start, x: start.x + dx, y: start.y + dy }
          : // Poignée haut-gauche : la largeur croît vers la gauche/le haut, coin bas-droit fixe.
            (() => {
              const w = start.w + Math.max(-dx, -dy * aspectRef.current);
              const h = w / aspectRef.current;
              return { x: start.x + start.w - w, y: start.y + start.h - h, w, h };
            })();
      apply(clampPipRect(next, parent.clientWidth, parent.clientHeight, aspectRef.current));
    };
    const onPointerUp = (e: PointerEvent) => {
      drag = null;
      if (frame.hasPointerCapture(e.pointerId)) frame.releasePointerCapture(e.pointerId);
    };
    // Double-clic : agrandir la vue caméra (≈ ¾ du viewport), re-double-clic = taille d'avant.
    let beforeMax: PipRect | null = null;
    const onDoubleClick = (e: MouseEvent) => {
      const r = rectRef.current;
      if (!r) return;
      e.preventDefault();
      if (beforeMax) {
        apply(clampPipRect(beforeMax, parent.clientWidth, parent.clientHeight, aspectRef.current));
        beforeMax = null;
        return;
      }
      beforeMax = r;
      const w = parent.clientWidth * 0.75;
      apply(
        clampPipRect(
          { x: (parent.clientWidth - w) / 2, y: 0, w, h: w / aspectRef.current },
          parent.clientWidth,
          parent.clientHeight,
          aspectRef.current,
        ),
      );
    };
    frame.addEventListener('pointerdown', onPointerDown);
    frame.addEventListener('pointermove', onPointerMove);
    frame.addEventListener('pointerup', onPointerUp);
    frame.addEventListener('dblclick', onDoubleClick);

    return () => {
      ro.disconnect();
      frame.removeEventListener('pointerdown', onPointerDown);
      frame.removeEventListener('pointermove', onPointerMove);
      frame.removeEventListener('pointerup', onPointerUp);
      frame.removeEventListener('dblclick', onDoubleClick);
      rectRef.current = null;
      onRectRef.current(null);
    };
  }, []);

  return (
    <div
      ref={frameRef}
      className="absolute cursor-move overflow-hidden rounded-md border border-primary/70 shadow-lg"
      title={t('review.pipFrame')}
    >
      <span className="pointer-events-none absolute right-1 top-1 rounded bg-primary/80 px-1 text-2xs font-medium text-primary-foreground">
        {label}
      </span>
      <span
        data-pip-resize
        className="absolute left-0 top-0 h-3 w-3 cursor-nwse-resize border-b border-r border-primary/70 bg-primary/40"
      />
    </div>
  );
}
