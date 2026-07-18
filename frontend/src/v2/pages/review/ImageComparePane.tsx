import { useQuery } from '@tanstack/react-query';
import { X, SplitSquareHorizontal } from 'lucide-react';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import ImageReviewViewer from '../../components/ImageReviewViewer';
import { VIEWER_ZONE, type MediaResp } from './reviewTypes';

/**
 * Pane B de la comparaison A/B **image** : visionneuse zoom/pan indépendante, sans
 * annotation. Mode côte-à-côte ; `onWipe` bascule vers la superposition à barre.
 */
export default function ImageComparePane({
  compareId,
  onClose,
  onWipe,
}: {
  compareId: number;
  onClose: () => void;
  onWipe: () => void;
}) {
  // staleTime Infinity : même règle que la review — URLs présignées, pas de refetch.
  const mediaQ = useQuery({
    queryKey: qk.media(compareId),
    queryFn: () => api.get<MediaResp>(`/api/media/${compareId}`),
    staleTime: Infinity,
  });
  const data = mediaQ.data ?? null;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs">
        <span className="truncate text-muted-foreground">
          Comparaison : <span className="text-foreground">{data?.media.originalName ?? '…'}</span>
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={onWipe}
            title="Basculer en mode wipe (superposition à barre)"
            className="flex items-center gap-1 rounded bg-primary/15 px-2 py-0.5 font-medium text-primary hover:bg-primary/25"
          >
            <SplitSquareHorizontal size={13} /> Wipe
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
        {data?.url && (
          <div className="absolute inset-0">
            <ImageReviewViewer
              src={data.url}
              alt={data.media.originalName}
              shapes={[]}
              editable={false}
              tool="move"
              color="#fff"
              width={3}
              alpha={1}
            />
          </div>
        )}
      </div>
    </div>
  );
}
