// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef, useState, type RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Diff, SplitSquareHorizontal, X } from 'lucide-react';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { VIEWER_ZONE, type MediaResp } from './reviewTypes';
import { useVideoSync } from './useVideoSync';
import { useT } from '../../i18n';

/**
 * Pane B de la comparaison vidéo (10.G + 14.C + 34.D) : vidéo esclave, muette et sans
 * contrôles, synchronisée sur le lecteur maître (hook `useVideoSync`). Côte-à-côte ou
 * case de la grille 2×2 ; `onWipe` (absent en grille) bascule vers le mode wipe.
 */
export default function VideoComparePane({
  compareId,
  masterRef,
  onClose,
  onWipe,
  onDiff,
}: {
  compareId: number;
  masterRef: RefObject<HTMLVideoElement | null>;
  onClose: () => void;
  /** Bascules wipe/diff — proposées seulement en A/B simple (pas en grille 34.D). */
  onWipe?: () => void;
  onDiff?: () => void;
}) {
  const t = useT();
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
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs">
        <span className="truncate text-muted-foreground">
          {t('review.compare.label')}{' '}
          <span className="text-foreground">{data?.media.originalName ?? '…'}</span>
        </span>
        <div className="flex items-center gap-1">
          {onWipe && (
            <button
              onClick={onWipe}
              title={t('review.compare.toWipe')}
              className="flex items-center gap-1 rounded bg-primary/15 px-2 py-0.5 font-medium text-primary hover:bg-primary/25"
            >
              <SplitSquareHorizontal size={13} /> {t('compare.wipe')}
            </button>
          )}
          {onDiff && (
            <button
              onClick={onDiff}
              title={t('review.compare.toDiff')}
              className="flex items-center gap-1 rounded bg-primary/15 px-2 py-0.5 font-medium text-primary hover:bg-primary/25"
            >
              <Diff size={13} /> {t('review.compare.diff')}
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
        {src && (
          <video
            ref={slaveRef}
            src={src}
            muted
            playsInline
            onLoadedMetadata={() => setSlaveReady(true)}
            className="pointer-events-none block max-h-full max-w-full"
          />
        )}
      </div>
    </div>
  );
}
