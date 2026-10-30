// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Clapperboard } from 'lucide-react';
import { useTimelineChain } from './useTimelineChain';
import { useT } from '../../i18n';

/**
 * Position within the edit, shown in the review header when the URL carries
 * `?timeline=ID` (Phase 45). The edit's name stays translated until someone renames it: it
 * is not stored in the database so as not to freeze a language.
 */
export default function TimelineNavigator({ mediaId }: { mediaId: number }) {
  const t = useT();
  const [searchParams] = useSearchParams();
  const { timeline, position, total, previous, next, go } = useTimelineChain(mediaId);
  if (!searchParams.get('timeline') || !timeline) return null;

  const label = timeline.name ?? t('timeline.defaultName');
  return (
    <div
      className="flex shrink-0 items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-xs text-muted-foreground"
      title={label}
    >
      <Clapperboard size={13} className="shrink-0" />
      <span className="max-w-32 truncate">{label}</span>
      <button
        onClick={() => go(previous)}
        disabled={!previous}
        title={t('timeline.previousShot')}
        className="flex h-5 w-5 items-center justify-center rounded hover:bg-secondary disabled:opacity-30"
      >
        <ChevronLeft size={13} />
      </button>
      <span className="tabular-nums">
        {position}/{total}
      </span>
      <button
        onClick={() => go(next)}
        disabled={!next}
        title={t('timeline.nextShot')}
        className="flex h-5 w-5 items-center justify-center rounded hover:bg-secondary disabled:opacity-30"
      >
        <ChevronRight size={13} />
      </button>
    </div>
  );
}
