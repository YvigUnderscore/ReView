import { useRef, useState, type RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, SplitSquareHorizontal } from 'lucide-react';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { VIEWER_ZONE, type MediaResp } from './reviewTypes';
import { useVideoSync } from './useVideoSync';

/**
 * Pane B de la comparaison A/B vidéo (10.G + 14.C) : vidéo esclave, muette et sans
 * contrôles, synchronisée sur le lecteur maître (hook `useVideoSync`). Mode côte-à-côte ;
 * `onWipe` bascule vers le mode wipe (superposition + curseur).
 */
export default function VideoComparePane({
  compareId,
  masterRef,
  onClose,
  onWipe,
}: {
  compareId: number;
  masterRef: RefObject<HTMLVideoElement | null>;
  onClose: () => void;
  onWipe: () => void;
}) {
  const slaveRef = useRef<HTMLVideoElement>(null);
  const [slaveReady, setSlaveReady] = useState(false);

  // staleTime Infinity : même règle que la review — URLs présignées, pas de refetch.
  const mediaQ = useQuery({
    queryKey: qk.media(compareId),
    queryFn: () => api.get<MediaResp>(`/api/media/${compareId}`),
    staleTime: Infinity,
  });
  const data = mediaQ.data ?? null;
  const src = data?.proxyUrl ?? data?.url;

  useVideoSync(masterRef, slaveRef, slaveReady);

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs">
        <span className="truncate text-muted-foreground">
          Comparaison : <span className="text-foreground">{data?.media.originalName ?? '…'}</span>
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={onWipe}
            title="Mode wipe (superposition)"
            className="rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <SplitSquareHorizontal size={14} />
          </button>
          <button
            onClick={onClose}
            title="Fermer la comparaison"
            className="rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <X size={14} />
          </button>
        </div>
      </div>
      <div className={VIEWER_ZONE}>
        {mediaQ.error && <p className="text-sm text-destructive">{mediaQ.error.message}</p>}
        {src && (
          <video
            ref={slaveRef}
            src={src}
            muted
            playsInline
            onLoadedMetadata={() => setSlaveReady(true)}
            className="pointer-events-none block max-h-[calc(100vh-16rem)] max-w-full"
          />
        )}
      </div>
    </div>
  );
}
