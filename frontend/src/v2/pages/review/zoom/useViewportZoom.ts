// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { isEditable } from '../../../lib/shortcuts';
import {
  isFit,
  panBy,
  wheelFactor,
  zoomBy as applyZoomBy,
  zoomStyle,
  zoomTo,
  ZOOM_FIT,
  PAN_CLICK_SLOP,
  type ZoomState,
} from './viewportZoom';

export interface ViewportZoom {
  state: ZoomState;
  /** Style à poser sur le calque média — et sur celui de la comparaison, pour qu'il suive. */
  style: CSSProperties;
  /** Gestionnaires de pointeur à poser sur le conteneur (la molette est branchée nativement). */
  handlers: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
  };
  /** Un glissement vient d'avoir lieu : le clic de relâchement ne doit pas lancer la lecture. */
  consumeClick: () => boolean;
  zoomBy: (factor: number) => void;
  reset: () => void;
  fit: boolean;
}

/**
 * Zoom et déplacement du lecteur vidéo — même geste que la visionneuse image : molette
 * pour zoomer sous le curseur, glissement pour déplacer, et le clavier pour s'en sortir
 * (`+` / `-`, `0` ajuste, `1` affiche à 100 %).
 *
 * Le bouton gauche sert déjà à lecture/pause et, en mode annotation, au tracé : il ne
 * déplace donc que sur la vidéo elle-même et seulement une fois zoomé — le bouton du
 * milieu, lui, déplace toujours. Le clic qui termine un glissement est consommé, sinon
 * chaque déplacement mettrait la lecture en pause.
 */
export function useViewportZoom({
  containerRef,
  oneToOneScale,
}: {
  containerRef: RefObject<HTMLElement | null>;
  /** Échelle d'un pixel média = un pixel écran, quand elle est connue (100 %). */
  oneToOneScale?: () => number | null;
}): ViewportZoom {
  const [state, setState] = useState<ZoomState>(ZOOM_FIT);
  const pan = useRef<{ id: number; x: number; y: number; moved: number } | null>(null);
  const clickBlocked = useRef(false);

  /** Écart du point (clientX, clientY) au centre du conteneur. */
  const offsetFromCenter = useCallback(
    (clientX: number, clientY: number): [number, number] => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return [0, 0];
      return [clientX - (rect.left + rect.width / 2), clientY - (rect.top + rect.height / 2)];
    },
    [containerRef],
  );

  // Molette branchée nativement : React pose `wheel` en écouteur passif, où
  // `preventDefault` est sans effet — la page défilerait derrière le zoom.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const [dx, dy] = offsetFromCenter(e.clientX, e.clientY);
      setState((s) => applyZoomBy(s, wheelFactor(e.deltaY), dx, dy));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [containerRef, offsetFromCenter]);

  // Le calcul du 100 % dépend de la boîte courante : gardé en miroir, pour ne pas
  // réabonner le clavier à chaque rendu du lecteur.
  const oneToOneRef = useRef(oneToOneScale);
  useEffect(() => {
    oneToOneRef.current = oneToOneScale;
  });

  // Clavier : le zoom reste pilotable sans souris (et rattrapable si la vue est perdue).
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target)) return;
      if (document.querySelector('[role="dialog"]')) return;
      const center = (target: number) => setState((s) => zoomTo(s, target, 0, 0));
      if (e.key === '+' || e.key === '=') setState((s) => applyZoomBy(s, 1.25));
      else if (e.key === '-') setState((s) => applyZoomBy(s, 1 / 1.25));
      else if (e.key === '0') setState(ZOOM_FIT);
      else if (e.key === '1') {
        const target = oneToOneRef.current?.();
        if (target && target > 0) center(target);
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    const onMedia = (e.target as Element | null)?.tagName === 'VIDEO';
    const middle = e.button === 1;
    if (!middle && !(e.button === 0 && onMedia && !isFit(state))) return;
    // Bouton du milieu : coupe le défilement automatique de Windows.
    if (middle) e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pan.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = pan.current;
    if (!p || p.id !== e.pointerId) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    p.moved += Math.abs(dx) + Math.abs(dy);
    setState((s) => panBy(s, dx, dy));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const p = pan.current;
    if (!p || p.id !== e.pointerId) return;
    if (p.moved > PAN_CLICK_SLOP) clickBlocked.current = true;
    pan.current = null;
  };

  const consumeClick = useCallback(() => {
    const blocked = clickBlocked.current;
    clickBlocked.current = false;
    return blocked;
  }, []);

  return {
    state,
    style: zoomStyle(state),
    handlers: { onPointerDown, onPointerMove, onPointerUp },
    consumeClick,
    zoomBy: useCallback((factor: number) => setState((s) => applyZoomBy(s, factor)), []),
    reset: useCallback(() => setState(ZOOM_FIT), []),
    fit: isFit(state),
  };
}
