// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Loader2, RotateCcw } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { useT } from '../../i18n';
import type { VideoPlayback } from './videoPlayback';

/**
 * What the video viewer shows when there is nothing to play: the assembly in progress, or the
 * failure with its reason and retry. Same language as the 3D viewer, which already did this.
 */
export default function VideoProcessingState({
  state,
  processingError,
  canReprocess,
  reprocessing,
  onReprocess,
}: {
  state: Exclude<VideoPlayback, 'play'>;
  processingError: string | null;
  canReprocess: boolean;
  reprocessing: boolean;
  onReprocess: () => void;
}) {
  const t = useT();
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-border bg-card/40 p-6">
      {state === 'assembling' ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={14} className="animate-spin" />
          {t('videoState.assembling')}
        </p>
      ) : (
        <div className="max-w-md space-y-3 text-center text-sm text-muted-foreground">
          <p>{t('videoState.failed')}</p>
          {/* Reason surfaced by the worker: without it, we do not know what to fix. */}
          {processingError && (
            <p className="rounded border border-border bg-card/60 px-2 py-1.5 text-left font-mono text-xs break-words text-foreground">
              {processingError}
            </p>
          )}
          {canReprocess && (
            <Button size="sm" onClick={onReprocess} disabled={reprocessing}>
              <RotateCcw size={13} /> {reprocessing ? t('common.retrying') : t('videoState.retry')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
