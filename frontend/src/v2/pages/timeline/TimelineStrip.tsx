// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router-dom';
import { AlertTriangle, FileWarning } from 'lucide-react';
import { reviewPath } from '../../lib/slug';
import { formatDuration } from '../review/timelineNav';
import type { TimelineClip } from '../../types/api';
import { useT } from '../../i18n';

/**
 * Le montage vu comme une bande de plans (Phase 45).
 *
 * Les trous ne sont pas masqués : un plan sans média occupe sa place, à sa durée, avec sa
 * propre vignette de carton. C'est la seule façon pour un superviseur de voir d'un coup
 * d'œil ce qui manque et où — un montage qui saute ses trous prétend être complet.
 */
export default function TimelineStrip({ clips, timelineId }: { clips: TimelineClip[]; timelineId: number }) {
  const t = useT();
  if (clips.length === 0) return null;

  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1">
      {clips.map((clip) => {
        const inner = (
          <>
            <div className="relative flex h-14 w-24 items-center justify-center overflow-hidden rounded border border-border bg-background">
              {clip.thumbnailUrl ? (
                <img src={clip.thumbnailUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <FileWarning
                  size={16}
                  className={clip.placeholder ? 'text-amber-500' : 'text-muted-foreground'}
                />
              )}
              {clip.durationMismatch && (
                <span
                  title={t('timeline.durationMismatch')}
                  className="absolute right-0.5 top-0.5 text-amber-400"
                >
                  <AlertTriangle size={11} />
                </span>
              )}
            </div>
            <div className="mt-0.5 flex w-24 items-baseline justify-between gap-1">
              <span className="truncate text-[10px] font-medium">{clip.shotCode}</span>
              <span className="text-[9px] tabular-nums text-muted-foreground">
                {formatDuration(clip.duration)}
              </span>
            </div>
            <div className="w-24 truncate text-[9px] text-muted-foreground">
              {clip.placeholder ? t('timeline.noMedia') : (clip.versionName ?? '')}
            </div>
          </>
        );

        return clip.mediaId !== null ? (
          <Link
            key={clip.shotId}
            to={`${reviewPath({ id: clip.mediaId, originalName: clip.mediaName })}?timeline=${timelineId}`}
            className="shrink-0 rounded p-0.5 hover:bg-secondary/60"
            title={`${clip.shotCode} · ${clip.shotName}`}
          >
            {inner}
          </Link>
        ) : (
          <div
            key={clip.shotId}
            className="shrink-0 rounded border border-dashed border-amber-500/40 p-0.5"
            title={`${clip.shotCode} · ${t('timeline.noMedia')}`}
          >
            {inner}
          </div>
        );
      })}
    </div>
  );
}
