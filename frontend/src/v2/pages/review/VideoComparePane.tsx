// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef, useState, type RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Diff, SplitSquareHorizontal, X } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { qk } from '../../lib/query';
import { VIEWER_ZONE, type MediaResp } from './reviewTypes';
import { useVideoSync } from './useVideoSync';
import { useFitBox } from './zoom/useFitBox';
import { useT } from '../../i18n';

/**
 * Pane B of the video comparison (10.G + 14.C + 34.D): a slave video, muted and without
 * controls, synchronized to the master player (`useVideoSync` hook). Side by side or a cell of
 * the 2×2 grid; `onWipe` (absent in the grid) switches to wipe mode.
 *
 * The video fits its box like the master's (`useFitBox`, common area of the
 * `CompareFitProvider`): until now it was displayed at its **source size**, so a 480p proxy
 * sat tiny in the center of a pane wider than it, between two black bands, next to a 1080p
 * that filled its half.
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
  /** Wipe/diff toggles — offered only in simple A/B (not in the 34.D grid). */
  onWipe?: () => void;
  onDiff?: () => void;
}) {
  const t = useT();
  const slaveRef = useRef<HTMLVideoElement>(null);
  const zoneRef = useRef<HTMLDivElement>(null);
  const [slaveReady, setSlaveReady] = useState(false);
  // Same "contain" fit as the master player, in the area common to the panes.
  const { box, setAspect } = useFitBox(zoneRef);

  // staleTime Infinity: same rule as the review — presigned URLs, no refetch.
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
      <div className={VIEWER_ZONE} ref={zoneRef}>
        {mediaQ.error && <p className="text-sm text-destructive">{mediaQ.error.message}</p>}
        {src && (
          <video
            ref={slaveRef}
            src={src}
            muted
            playsInline
            onLoadedMetadata={(e) => {
              setSlaveReady(true);
              if (e.currentTarget.videoWidth > 0)
                setAspect(e.currentTarget.videoWidth / e.currentTarget.videoHeight);
            }}
            className="pointer-events-none block max-h-full max-w-full"
            style={box ? { width: box.w, height: box.h } : undefined}
          />
        )}
      </div>
    </div>
  );
}
