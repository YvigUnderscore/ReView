// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ZoomIn, ZoomOut, Maximize, Expand, Info } from 'lucide-react';
import { AnnotationCanvas, type Shape, type Tool } from './AnnotationCanvas';
import { useT } from '../i18n';

/**
 * Visionneuse d'image pour la review : zoom (molette) + pan, avec overlay
 * d'annotation ancré au pixel. Les annotations peuvent déborder hors de l'image
 * (marge dessinable autour), et restent alignées lors du zoom/pan car image et
 * overlay partagent la même transformation.
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
  onChange?: (s: Shape[]) => void;
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
  const t = useT();
  const viewportRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [base, setBase] = useState<{ w: number; h: number } | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [showInfo, setShowInfo] = useState(false);
  const pan = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

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

  // Pan : clic milieu/droit toujours ; clic gauche si on n'annote pas
  const onPointerDown = (e: React.PointerEvent) => {
    const panButton = e.button === 1 || e.button === 2 || (e.button === 0 && !editable);
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
  const fmtSize = (b?: number | null) =>
    b == null ? null : b > 1e6 ? `${(b / 1e6).toFixed(1)} Mo` : `${Math.round(b / 1e3)} Ko`;
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
          cursor: editable ? 'crosshair' : 'grab',
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

      {/* Panneau infos repliable (14.D) */}
      {showInfo && (
        <div className="absolute right-3 top-3 min-w-[10rem] rounded-md border border-border bg-card/95 p-2 text-xs backdrop-blur">
          <div className="mb-1 font-medium text-foreground">{t('imageViewer.info')}</div>
          <dl className="space-y-0.5 text-muted-foreground">
            {natural && (
              <div className="flex justify-between gap-3">
                <dt>{t('imageViewer.resolution')}</dt>
                <dd className="tabular-nums text-foreground">
                  {natural.w} × {natural.h}
                </dd>
              </div>
            )}
            {info?.format && (
              <div className="flex justify-between gap-3">
                <dt>{t('imageViewer.format')}</dt>
                <dd className="text-foreground">{info.format}</dd>
              </div>
            )}
            {fmtSize(info?.sizeBytes) && (
              <div className="flex justify-between gap-3">
                <dt>{t('imageViewer.size')}</dt>
                <dd className="text-foreground">{fmtSize(info?.sizeBytes)}</dd>
              </div>
            )}
          </dl>
        </div>
      )}

      {/* Contrôles de zoom (14.D : + 100 % et infos) */}
      <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-md border border-border bg-card/90 p-1 backdrop-blur">
        <button
          onClick={() => zoomBy(1 / 1.25)}
          title={t('imageViewer.zoomOut')}
          className="rounded p-1.5 hover:bg-muted"
        >
          <ZoomOut size={16} />
        </button>
        <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">
          {Math.round(scale * 100)}%
        </span>
        <button
          onClick={() => zoomBy(1.25)}
          title={t('imageViewer.zoomIn')}
          className="rounded p-1.5 hover:bg-muted"
        >
          <ZoomIn size={16} />
        </button>
        <button
          onClick={oneToOne}
          title={t('imageViewer.actualSize')}
          className="rounded px-1.5 py-1 text-xs font-medium hover:bg-muted"
        >
          1:1
        </button>
        <button onClick={reset} title={t('imageViewer.fit')} className="rounded p-1.5 hover:bg-muted">
          <Maximize size={16} />
        </button>
        <button
          onClick={fullscreen}
          title={t('imageViewer.fullscreen')}
          className="rounded p-1.5 hover:bg-muted"
        >
          <Expand size={16} />
        </button>
        <button
          onClick={() => setShowInfo((v) => !v)}
          title={t('imageViewer.info')}
          aria-pressed={showInfo}
          className={`rounded p-1 hover:bg-muted ${showInfo ? 'text-primary' : ''}`}
        >
          <Info size={16} />
        </button>
      </div>
    </div>
  );
}
