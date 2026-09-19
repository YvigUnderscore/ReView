// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnnotationCanvas, type Shape, type Tool } from './AnnotationCanvas';
import ImageViewerHud from './image/ImageViewerHud';

/**
 * Visionneuse d'image pour la review : zoom (molette) + pan, avec overlay d'annotation ancré
 * au pixel. Image et overlay partagent la même transformation, donc restent alignés au
 * zoom/pan ; la marge dessinable autorise les annotations hors cadre.
 */
const MIN_SCALE = 0.1;
const MAX_SCALE = 20;
// Marge dessinable autour de l'image (50% de chaque côté) pour les annotations hors-cadre.
const MARGIN = 0.5;

/** Vue courante normalisée (session live) : zoom relatif au fit + centre en fraction d'image. */
export interface ImageView {
  scale: number;
  cx: number;
  cy: number;
}
export interface ImageViewApi {
  capture: () => ImageView | null;
  apply: (v: ImageView) => void;
}

export default function ImageReviewViewer({
  src,
  alt,
  shapes,
  onChange,
  editable,
  tool,
  color,
  width,
  alpha,
  info,
  pinned,
  onFullscreen,
  viewApiRef,
  onUserView,
  onViewChange,
}: {
  src: string;
  alt: string;
  shapes: Shape[];
  onChange?: (s: Shape[], stepKey?: string) => void;
  editable: boolean;
  tool: Tool;
  color: string;
  width: number;
  alpha: number;
  /** Métadonnées affichées dans le panneau infos repliable (14.D). */
  info?: { format?: string | null; sizeBytes?: number | null };
  /** Éléments épinglés au canvas (images de référence…) : rendus dans le plan transformé,
   *  ils suivent le zoom/pan comme l'image. */
  pinned?: ReactNode;
  /** Plein écran de tout le bloc review (fourni par la page) ; sinon plein écran local. */
  onFullscreen?: () => void;
  /** API impérative de la vue (zoom/pan) — session live : capture pilote / application spectateur. */
  viewApiRef?: React.MutableRefObject<ImageViewApi | null>;
  /** Interaction zoom/pan locale (molette, pan, boutons) — prise de main en session live. */
  onUserView?: () => void;
  /** Vue émise à chaque changement (fit inclus) — réplication A/B de la comparaison (34.D). */
  onViewChange?: (v: ImageView) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [base, setBase] = useState<{ w: number; h: number } | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const pan = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  // L'outil `ref` place une référence collée : il ne dessine pas, et le clic gauche pane.
  const drawing = editable && tool !== 'ref';

  // Re-fit si la source change : ajustement d'état pendant le render
  // (https://react.dev/learn/you-might-not-need-an-effect) — le onLoad de la
  // nouvelle image refera le fit.
  const [prevSrc, setPrevSrc] = useState(src);
  if (src !== prevSrc) {
    setPrevSrc(src);
    setBase(null);
  }

  // Taille de base : ajuste l'image dans le viewport (contain), centrée.
  const fit = (natW: number, natH: number) => {
    const vp = viewportRef.current;
    if (!vp) return;
    const { clientWidth: vw, clientHeight: vh } = vp;
    const r = Math.min(vw / natW, vh / natH);
    const w = natW * r,
      h = natH * r;
    setBase({ w, h });
    setScale(1);
    setOffset({ x: (vw - w) / 2, y: (vh - h) / 2 });
  };

  const onImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight });
    fit(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight);
  };

  // Vue partagée en session live : capture (pilote) / application (spectateur) — le centre
  // est en fraction de l'image de base, indépendant de la taille de viewport de chacun.
  useEffect(() => {
    const capture = (): ImageView | null => {
      const vp = viewportRef.current;
      if (!vp || !base) return null;
      return {
        scale,
        cx: (vp.clientWidth / 2 - offset.x) / (base.w * scale),
        cy: (vp.clientHeight / 2 - offset.y) / (base.h * scale),
      };
    };
    // Réplication A/B (34.D) : chaque changement de vue est poussé au relais, qui
    // l'applique à l'autre pane (l'écho est coupé côté relais).
    if (onViewChange) {
      const v = capture();
      if (v) onViewChange(v);
    }
    if (!viewApiRef) return;
    viewApiRef.current = {
      capture,
      apply: (v) => {
        const vp = viewportRef.current;
        if (!vp || !base) return;
        setScale(v.scale);
        setOffset({
          x: vp.clientWidth / 2 - v.cx * base.w * v.scale,
          y: vp.clientHeight / 2 - v.cy * base.h * v.scale,
        });
      },
    };
    return () => {
      viewApiRef.current = null;
    };
  }, [viewApiRef, base, scale, offset, onViewChange]);

  // Zoom molette centré sur le curseur
  const onWheel = (e: React.WheelEvent) => {
    if (!base) return;
    e.preventDefault();
    onUserView?.();
    const vp = viewportRef.current!.getBoundingClientRect();
    const cx = e.clientX - vp.left,
      cy = e.clientY - vp.top;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor));
    const k = next / scale;
    // Garde le point sous le curseur fixe
    setOffset((o) => ({ x: cx - (cx - o.x) * k, y: cy - (cy - o.y) * k }));
    setScale(next);
  };

  // Pan : clic milieu/droit toujours ; clic gauche si on ne dessine pas
  const onPointerDown = (e: React.PointerEvent) => {
    const panButton = e.button === 1 || e.button === 2 || (e.button === 0 && !drawing);
    if (!panButton) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pan.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pan.current) return;
    onUserView?.();
    setOffset({
      x: pan.current.ox + (e.clientX - pan.current.x),
      y: pan.current.oy + (e.clientY - pan.current.y),
    });
  };
  const onPointerUp = () => {
    pan.current = null;
  };

  const zoomBy = (factor: number) => {
    const vp = viewportRef.current;
    if (!vp) return;
    onUserView?.();
    const cx = vp.clientWidth / 2,
      cy = vp.clientHeight / 2;
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor));
    const k = next / scale;
    setOffset((o) => ({ x: cx - (cx - o.x) * k, y: cy - (cy - o.y) * k }));
    setScale(next);
  };
  const reset = () => {
    if (natural) fit(natural.w, natural.h);
  };
  // 100 % : un pixel image = un pixel écran (scale = taille naturelle / taille de base), centré.
  const oneToOne = () => {
    const vp = viewportRef.current;
    if (!vp || !base || !natural) return;
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, natural.w / base.w));
    const cx = vp.clientWidth / 2,
      cy = vp.clientHeight / 2;
    const k = next / scale;
    setOffset((o) => ({ x: cx - (cx - o.x) * k, y: cy - (cy - o.y) * k }));
    setScale(next);
  };
  const rootRef = useRef<HTMLDivElement>(null);
  // Plein écran : celui fourni par la page (bloc review complet) sinon repli local à l'image.
  const fullscreen = onFullscreen ?? (() => void rootRef.current?.requestFullscreen?.());

  return (
    <div ref={rootRef} className="relative h-full w-full bg-background">
      <div
        ref={viewportRef}
        className="relative h-full w-full overflow-hidden"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        // Surtout pas de `preventDefault` ici (A3) : ce viewport est un descendant du
        // ContextMenuTrigger de la review image, et Radix compose les gestionnaires avec
        // `checkForDefaultPrevented` — marquer l'événement comme traité empêchait le menu
        // métier (copier/télécharger l'image, miniature, playlist, annoter) de s'ouvrir.
        // Le menu natif est déjà bloqué en amont par ContextMenuGuard.
        style={{
          cursor: drawing ? 'crosshair' : 'grab',
          touchAction: 'none',
          // Fond gris + grille de lignes blanches légères, fixée au canvas : la grille
          // suit le pan (background-position) et le zoom (background-size).
          backgroundColor: 'hsl(var(--muted) / 0.35)',
          backgroundImage:
            'linear-gradient(to right, rgba(255,255,255,0.07) 1px, transparent 1px),' +
            'linear-gradient(to bottom, rgba(255,255,255,0.07) 1px, transparent 1px)',
          backgroundSize: `${48 * scale}px ${48 * scale}px`,
          backgroundPosition: `${offset.x}px ${offset.y}px`,
        }}
      >
        {base && (
          <div
            className="absolute left-0 top-0"
            style={{
              width: base.w,
              height: base.h,
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
              transformOrigin: '0 0',
            }}
          >
            <img src={src} alt={alt} className="block h-full w-full select-none" draggable={false} />
            {pinned}
            {(editable || shapes.length > 0) && (
              <AnnotationCanvas
                shapes={shapes}
                onChange={onChange}
                editable={editable}
                tool={tool}
                color={color}
                width={width}
                alpha={alpha}
                margin={MARGIN}
              />
            )}
          </div>
        )}
        {/* Image masquée juste pour récupérer la taille naturelle au chargement */}
        {!base && <img src={src} alt={alt} onLoad={onImgLoad} className="invisible absolute" />}
      </div>

      <ImageViewerHud
        scale={scale}
        natural={natural}
        info={info}
        onZoom={zoomBy}
        onActualSize={oneToOne}
        onFit={reset}
        onFullscreen={fullscreen}
      />
    </div>
  );
}
