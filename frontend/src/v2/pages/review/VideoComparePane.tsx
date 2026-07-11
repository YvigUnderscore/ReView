import { useEffect, useRef, useState, type RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { VIEWER_ZONE, type MediaResp } from './reviewTypes';

/**
 * Pane B de la comparaison A/B vidéo (backlog P2 10.G) : vidéo esclave, muette et
 * sans contrôles, synchronisée sur le lecteur maître (play/pause/seek/vitesse +
 * correction de dérive pendant la lecture).
 */
export default function VideoComparePane({
  compareId,
  masterRef,
  onClose,
}: {
  compareId: number;
  masterRef: RefObject<HTMLVideoElement | null>;
  onClose: () => void;
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

  useEffect(() => {
    const m = masterRef.current;
    const s = slaveRef.current;
    if (!m || !s || !slaveReady) return;
    const syncTime = () => {
      s.currentTime = m.currentTime;
    };
    const onPlay = () => {
      syncTime();
      void s.play().catch(() => undefined);
    };
    const onPause = () => {
      s.pause();
      syncTime();
    };
    const onRate = () => {
      s.playbackRate = m.playbackRate;
    };
    // Correction de dérive : les deux lecteurs décodent indépendamment.
    const onTime = () => {
      if (!m.paused && Math.abs(s.currentTime - m.currentTime) > 0.15) syncTime();
    };
    m.addEventListener('play', onPlay);
    m.addEventListener('pause', onPause);
    m.addEventListener('seeking', syncTime);
    m.addEventListener('ratechange', onRate);
    m.addEventListener('timeupdate', onTime);
    // État initial : cale la vidéo B sur la position/lecture courante du maître.
    s.playbackRate = m.playbackRate;
    syncTime();
    if (!m.paused) void s.play().catch(() => undefined);
    return () => {
      m.removeEventListener('play', onPlay);
      m.removeEventListener('pause', onPause);
      m.removeEventListener('seeking', syncTime);
      m.removeEventListener('ratechange', onRate);
      m.removeEventListener('timeupdate', onTime);
    };
  }, [masterRef, slaveReady]);

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs">
        <span className="truncate text-muted-foreground">
          Comparaison : <span className="text-foreground">{data?.media.originalName ?? '…'}</span>
        </span>
        <button
          onClick={onClose}
          title="Fermer la comparaison"
          className="rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <X size={14} />
        </button>
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
