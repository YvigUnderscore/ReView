import { useRef, useState, type RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Columns2 } from 'lucide-react';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { type MediaResp } from './reviewTypes';
import { useVideoSync } from './useVideoSync';

/**
 * Comparaison A/B vidéo en mode **wipe** (14.C) : la vidéo B, synchronisée sur le maître,
 * est superposée à A et rognée par un curseur vertical déplaçable (clip-path). À placer dans
 * le conteneur `relative` de la vidéo A.
 */
export default function VideoWipeOverlay({
  compareId,
  masterRef,
  onClose,
  onSide,
}: {
  compareId: number;
  masterRef: RefObject<HTMLVideoElement | null>;
  onClose: () => void;
  onSide: () => void;
}) {
  const slaveRef = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [pos, setPos] = useState(0.5);
  const dragging = useRef(false);

  const mediaQ = useQuery({
    queryKey: qk.media(compareId),
    queryFn: () => api.get<MediaResp>(`/api/media/${compareId}`),
    staleTime: Infinity,
  });
  const src = mediaQ.data?.proxyUrl ?? mediaQ.data?.url;

  useVideoSync(masterRef, slaveRef, ready);

  const moveFrom = (clientX: number) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)));
  };

  return (
    <div
      ref={wrapRef}
      className="absolute inset-0 z-20 select-none"
      onPointerMove={(e) => dragging.current && moveFrom(e.clientX)}
      onPointerUp={() => (dragging.current = false)}
    >
      {src && (
        <video
          ref={slaveRef}
          src={src}
          muted
          playsInline
          onLoadedMetadata={() => setReady(true)}
          className="pointer-events-none absolute inset-0 h-full w-full object-contain"
          style={{ clipPath: `inset(0 0 0 ${pos * 100}%)` }}
        />
      )}
      {/* Curseur de wipe */}
      <div
        className="absolute inset-y-0 z-30 -ml-3 flex w-6 cursor-ew-resize items-center justify-center"
        style={{ left: `${pos * 100}%` }}
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
      >
        <div className="h-full w-0.5 bg-primary" />
        <div className="absolute h-6 w-6 rounded-full border-2 border-primary bg-card" />
      </div>
      {/* Contrôles flottants */}
      <div className="absolute right-2 top-2 z-40 flex items-center gap-1 rounded-md border border-border bg-card/90 px-1 py-0.5 backdrop-blur">
        <button onClick={onSide} title="Vue côte à côte" className="rounded p-1 hover:bg-secondary">
          <Columns2 size={14} />
        </button>
        <button onClick={onClose} title="Fermer la comparaison" className="rounded p-1 hover:bg-secondary">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
