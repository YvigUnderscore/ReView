// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnnotationCanvas, type Shape, type Tool } from './AnnotationCanvas';
import ImageViewerHud from './image/ImageViewerHud';
import { useViewShortcuts } from '../pages/review/zoom/useViewShortcuts';

/**
 * Image viewer for review: zoom (wheel) + pan, with an annotation overlay anchored
 * at the pixel. Image and overlay share the same transform, so they stay aligned under
 * zoom/pan; the drawable margin allows off-frame annotations.
 */
const MIN_SCALE = 0.1;
const MAX_SCALE = 20;
// Drawable margin around the image (50% on each side) for off-frame annotations.
const MARGIN = 0.5;

/** Current normalized view (live session): zoom relative to fit, plus the centre as a fraction of the image. */
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
  viewShortcuts = false,
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
  /** Metadata displayed in the collapsible info panel (14.D). */
  info?: { format?: string | null; sizeBytes?: number | null };
  /** Elements pinned to the canvas (reference images…): rendered in the transformed plane,
   *  they follow zoom/pan like the image. */
  pinned?: ReactNode;
  /** Full screen of the whole review block (provided by the page); otherwise local full screen. */
  onFullscreen?: () => void;
  /** Imperative API of the view (zoom/pan). Live session: driver capture / viewer application. */
  viewApiRef?: React.MutableRefObject<ImageViewApi | null>;
  /** Local zoom/pan interaction (wheel, pan, buttons): takeover in a live session. */
  onUserView?: () => void;
  /** View emitted at each change (fit included): A/B replication of the comparison (34.D). */
  onViewChange?: (v: ImageView) => void;
  /**
   * This viewer carries the view shortcuts `F` (fit) and `H` (actual size): the
   * two actions the rail announces. Reserved for the **main** viewer of the review, since the comparison
   * panes would otherwise respond to the same keystroke, each on their own side.
   */
  viewShortcuts?: boolean;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [base, setBase] = useState<{ w: number; h: number } | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const pan = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  // The `ref` tool places a pasted reference: it does not draw, and the left click pans.
  const drawing = editable && tool !== 'ref';

  // Re-fit if the source changes: state adjustment during render
  // (https://react.dev/learn/you-might-not-need-an-effect); the onLoad of the
  // new image will redo the fit.
  const [prevSrc, setPrevSrc] = useState(src);
  if (src !== prevSrc) {
    setPrevSrc(src);
    setBase(null);
  }

  // Base size: fits the image in the viewport (contain), centred.
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

  // View shared in a live session: capture (driver) / application (viewer). The centre
  // is a fraction of the base image, independent of each one's viewport size.
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
    // A/B replication (34.D): each view change is pushed to the relay, which
    // applies it to the other pane (the echo is cut on the relay side).
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

  // Wheel zoom centred on the cursor
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
    // Keeps the point under the cursor fixed
    setOffset((o) => ({ x: cx - (cx - o.x) * k, y: cy - (cy - o.y) * k }));
    setScale(next);
  };

  // Pan: middle/right click always; left click if not drawing
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
  // 100%: one image pixel = one screen pixel (scale = natural size / base size), centred.
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
  // `F` fits, `H` returns to 100%: the two HUD buttons, via the keyboard. The rail
  // declared them forever without anyone listening.
  useViewShortcuts(viewShortcuts ? { fit: reset, oneToOne } : null);
  const rootRef = useRef<HTMLDivElement>(null);
  // Full screen: the one provided by the page (whole review block), otherwise a local fallback to the image.
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
        // Above all, no `preventDefault` here (A3): this viewport is a descendant of the
        // ContextMenuTrigger of the image review, and Radix composes the handlers with
        // `checkForDefaultPrevented`: marking the event as handled prevented the business
        // menu (copy/download the image, thumbnail, playlist, annotate) from opening.
        // The native menu is already blocked upstream by ContextMenuGuard.
        style={{
          cursor: drawing ? 'crosshair' : 'grab',
          touchAction: 'none',
          // Grey background + light white line grid, fixed to the canvas: the grid
          // follows the pan (background-position) and the zoom (background-size).
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
