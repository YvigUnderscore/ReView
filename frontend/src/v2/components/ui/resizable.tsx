import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils';
import { clampSize, readStoredSize, writeStoredSize } from './resizable.helpers';

interface ResizablePanelProps {
  /** Clé de persistance (localStorage). Une clé = un panneau. */
  storageKey: string;
  /** Bord portant la poignée : `left` pour un panneau ancré à droite (sidebar commentaires). */
  side?: 'left' | 'right';
  defaultSize: number;
  min?: number;
  max?: number;
  className?: string;
  children: ReactNode;
}

/**
 * Panneau à largeur redimensionnable par poignée, persistée en localStorage.
 * Réutilisable (sidebar commentaires…). Ne gère que l'axe horizontal.
 */
export function ResizablePanel({
  storageKey,
  side = 'left',
  defaultSize,
  min = 240,
  max = 640,
  className,
  children,
}: ResizablePanelProps) {
  const [size, setSize] = useState(() => clampSize(readStoredSize(storageKey, defaultSize), min, max));
  const drag = useRef<{ startX: number; startSize: number } | null>(null);

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!drag.current) return;
      const delta = e.clientX - drag.current.startX;
      // Poignée à gauche : glisser vers la gauche agrandit un panneau ancré à droite.
      const next = drag.current.startSize + (side === 'left' ? -delta : delta);
      setSize(clampSize(next, min, max));
    },
    [side, min, max],
  );

  const stop = useCallback(() => {
    drag.current = null;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    setSize((s) => {
      writeStoredSize(storageKey, s);
      return s;
    });
  }, [storageKey]);

  useEffect(() => {
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stop);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stop);
    };
  }, [onPointerMove, stop]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      drag.current = { startX: e.clientX, startSize: size };
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
    },
    [size],
  );

  return (
    <div className={cn('relative shrink-0', className)} style={{ width: size }}>
      <div
        role="separator"
        aria-orientation="vertical"
        onPointerDown={onPointerDown}
        className={cn(
          'absolute top-0 z-10 h-full w-1.5 cursor-col-resize bg-transparent transition-colors hover:bg-primary/40',
          side === 'left' ? '-left-0.5' : '-right-0.5',
        )}
      />
      {children}
    </div>
  );
}
