import { useCallback, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Dialog } from './dialog';
import { wrapIndex } from './lightbox.helpers';
import { cn } from '../../lib/utils';

export interface LightboxImage {
  src: string;
  alt?: string;
}

const ZOOM_MIN = 1;
const ZOOM_MAX = 6;
const ZOOM_STEP = 0.25;
const clampZoom = (z: number) => Math.min(Math.max(z, ZOOM_MIN), ZOOM_MAX);

interface LightboxProps {
  images: LightboxImage[];
  index: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onIndexChange: (index: number) => void;
}

/**
 * Lightbox plein écran : zoom (molette/boutons), pan (glisser zoomé), carrousel
 * (flèches + ←/→), fermeture croix/Échap (focus-trap via Dialog). Réutilisée par
 * les commentaires et la review image.
 */
export function Lightbox({ images, index, open, onOpenChange, onIndexChange }: LightboxProps) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const count = images.length;
  const current = images[wrapIndex(index, count)];

  const reset = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // Remet zoom/pan à zéro quand l'image ou l'ouverture change (ajustement au render,
  // pattern React recommandé — évite un effet qui appelle setState).
  const [track, setTrack] = useState({ index, open });
  if (track.index !== index || track.open !== open) {
    setTrack({ index, open });
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  const go = useCallback(
    (dir: number) => {
      if (count > 1) onIndexChange(wrapIndex(index + dir, count));
    },
    [count, index, onIndexChange],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === '+' || e.key === '=') setZoom((z) => clampZoom(z + ZOOM_STEP));
      else if (e.key === '-') setZoom((z) => clampZoom(z - ZOOM_STEP));
    },
    [go],
  );

  const onWheel = useCallback((e: React.WheelEvent) => {
    setZoom((z) => clampZoom(z - Math.sign(e.deltaY) * ZOOM_STEP));
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (zoom <= 1) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setPan({
      x: drag.current.px + (e.clientX - drag.current.x),
      y: drag.current.py + (e.clientY - drag.current.y),
    });
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  if (!current) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/90 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onKeyDown={onKeyDown}
          className="fixed inset-0 z-50 flex items-center justify-center outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0"
        >
          <DialogPrimitive.Title className="sr-only">Aperçu image</DialogPrimitive.Title>

          <div
            className="flex h-full w-full items-center justify-center overflow-hidden"
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            <img
              src={current.src}
              alt={current.alt ?? ''}
              draggable={false}
              className={cn(
                'max-h-[92vh] max-w-[92vw] select-none object-contain',
                zoom > 1 ? 'cursor-grab' : 'cursor-default',
              )}
              style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
            />
          </div>

          {count > 1 && (
            <>
              <NavButton side="left" onClick={() => go(-1)}>
                <ChevronLeft size={28} />
              </NavButton>
              <NavButton side="right" onClick={() => go(1)}>
                <ChevronRight size={28} />
              </NavButton>
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-white">
                {wrapIndex(index, count) + 1} / {count}
              </div>
            </>
          )}

          <div className="absolute right-3 top-3 flex items-center gap-1">
            <ToolButton title="Zoom −" onClick={() => setZoom((z) => clampZoom(z - ZOOM_STEP))}>
              <ZoomOut size={18} />
            </ToolButton>
            <ToolButton title="Zoom +" onClick={() => setZoom((z) => clampZoom(z + ZOOM_STEP))}>
              <ZoomIn size={18} />
            </ToolButton>
            <ToolButton title="Réinitialiser" onClick={reset}>
              <Maximize2 size={18} />
            </ToolButton>
            <ToolButton title="Fermer" onClick={() => onOpenChange(false)}>
              ✕
            </ToolButton>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </Dialog>
  );
}

function NavButton({
  side,
  onClick,
  children,
}: {
  side: 'left' | 'right';
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'absolute top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white transition-colors hover:bg-black/70',
        side === 'left' ? 'left-3' : 'right-3',
      )}
    >
      {children}
    </button>
  );
}

function ToolButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-md bg-black/50 text-sm text-white transition-colors hover:bg-black/70"
    >
      {children}
    </button>
  );
}
