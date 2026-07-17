import { useQuery } from '@tanstack/react-query';
import { X, Columns2 } from 'lucide-react';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { VIEWER_ZONE, type MediaResp } from './reviewTypes';
import { useWipe } from './useWipe';
import WipeControl from './WipeControl';

/**
 * Comparaison A/B **image** en mode wipe : les deux images sont superposées en
 * `object-contain` (zoom/pan désactivés le temps de la comparaison), B rognée par la
 * barre déplaçable et rotative. Remplace la visionneuse pendant la comparaison.
 */
export default function ImageWipeOverlay({
  aUrl,
  aName,
  compareId,
  onClose,
  onSide,
}: {
  aUrl: string;
  aName: string;
  compareId: number;
  onClose: () => void;
  onSide: () => void;
}) {
  const wipe = useWipe();
  const mediaQ = useQuery({
    queryKey: qk.media(compareId),
    queryFn: () => api.get<MediaResp>(`/api/media/${compareId}`),
    staleTime: Infinity,
  });
  const b = mediaQ.data ?? null;

  return (
    <div className={VIEWER_ZONE}>
      <div className="absolute inset-0 select-none">
        <img
          src={aUrl}
          alt={aName}
          className="absolute inset-0 h-full w-full object-contain"
          draggable={false}
        />
        {b?.url && (
          <img
            src={b.url}
            alt={b.media.originalName}
            draggable={false}
            className="pointer-events-none absolute inset-0 h-full w-full object-contain"
            style={{ clipPath: wipe.clipPath }}
          />
        )}
        <WipeControl wipe={wipe} />
        <div className="absolute right-2 top-2 z-40 flex items-center gap-1 rounded-md border border-border bg-card/90 px-1 py-0.5 backdrop-blur">
          <button onClick={onSide} title="Vue côte à côte" className="rounded p-1 hover:bg-secondary">
            <Columns2 size={14} />
          </button>
          <button onClick={onClose} title="Fermer la comparaison" className="rounded p-1 hover:bg-secondary">
            <X size={14} />
          </button>
        </div>
        {mediaQ.error && (
          <p className="absolute bottom-2 left-2 text-xs text-destructive">{mediaQ.error.message}</p>
        )}
      </div>
    </div>
  );
}
