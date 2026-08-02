// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from '@tanstack/react-query';
import { Diff, SplitSquareHorizontal, X } from 'lucide-react';
import type { ComponentProps } from 'react';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import ImageReviewViewer from '../../components/ImageReviewViewer';
import { VIEWER_ZONE, type MediaResp } from './reviewTypes';
import { useT } from '../../i18n';

/**
 * Pane B de la comparaison A/B **image** : visionneuse zoom/pan sans annotation, dont la
 * vue est répliquée avec le maître (34.D — `viewApiRef`/`onViewChange` branchés sur le
 * relais useImageCompareSync). Mode côte-à-côte ; `onWipe` bascule vers la superposition.
 */
export default function ImageComparePane({
  compareId,
  onClose,
  onWipe,
  onDiff,
  viewApiRef,
  onViewChange,
}: {
  compareId: number;
  onClose: () => void;
  onWipe: () => void;
  /** Bascule vers le mode différence amplifiée (34.E). */
  onDiff?: () => void;
  viewApiRef?: ComponentProps<typeof ImageReviewViewer>['viewApiRef'];
  onViewChange?: ComponentProps<typeof ImageReviewViewer>['onViewChange'];
}) {
  const t = useT();
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
            title={t('review.compare.toWipe')}
            className="flex items-center gap-1 rounded bg-primary/15 px-2 py-0.5 font-medium text-primary hover:bg-primary/25"
          >
            <SplitSquareHorizontal size={13} /> Wipe
          </button>
          {onDiff && (
            <button
              onClick={onDiff}
              title={t('review.compare.toDiff')}
              className="flex items-center gap-1 rounded bg-primary/15 px-2 py-0.5 font-medium text-primary hover:bg-primary/25"
            >
              <Diff size={13} /> Diff
            </button>
          )}
          <button
            onClick={onClose}
            title={t('review.compare.close')}
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
              viewApiRef={viewApiRef}
              onViewChange={onViewChange}
            />
          </div>
        )}
      </div>
    </div>
  );
}
