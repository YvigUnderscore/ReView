// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, FileWarning, Pause, Play } from 'lucide-react';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import { parseIdParam, projectPath } from '../lib/slug';
import { SkeletonRows } from '../components/ui/skeleton';
import TimelineScrubber from './timeline/TimelineScrubber';
import TimelineComments from './timeline/TimelineComments';
import { useContinuousPlayback } from './timeline/useContinuousPlayback';
import { formatTimecode, localTimeAt } from './timeline/timelinePlayback';
import type { TimelineView } from '../types/api';
import { useT } from '../i18n';

/**
 * Lecteur de montage (Phase 46) : le film d'un bout à l'autre, sans coupure.
 *
 * Deux lecteurs vidéo se relaient — pendant que l'un joue, l'autre charge le plan suivant
 * — et la bascule n'est qu'un échange de visibilité. Les repères de plan et de séquence
 * vivent sur la barre de temps et dans le bandeau, jamais sur l'image : c'est le sens de
 * « aucune interruption ».
 */
export default function TimelinePlayerPage() {
  const t = useT();
  const { id } = useParams();
  const timelineId = parseIdParam(id);

  const timelineQ = useQuery({
    queryKey: qk.timeline(timelineId),
    queryFn: () =>
      api.get<{ timeline: TimelineView }>(`/api/timelines/${timelineId}`).then((d) => d.timeline),
    enabled: Number.isFinite(timelineId),
  });
  const timeline = timelineQ.data ?? null;
  const items = timeline?.items ?? [];
  const videoA = useRef<HTMLVideoElement | null>(null);
  const videoB = useRef<HTMLVideoElement | null>(null);
  const playback = useContinuousPlayback(items, videoA, videoB);
  const { clip } = playback;

  if (timelineQ.isLoading) return <SkeletonRows count={4} />;
  if (!timeline) return <p className="p-6 text-sm text-destructive">{t('timeline.notFound')}</p>;

  const label = timeline.name ?? t('timeline.defaultName');
  const showPlaceholder = clip !== null && clip.mediaId === null;

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2">
        <Link
          to={projectPath({ id: timeline.projectId })}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={15} /> {t('common.back')}
        </Link>
        <h1 className="text-sm font-medium">{label}</h1>
        {/* Libellé permanent : on sait en continu où l'on se trouve dans le film. */}
        {clip && (
          <span className="rounded border border-border px-2 py-0.5 text-xs">
            <span className="text-muted-foreground">{clip.sequenceCode ?? '—'}</span> · {clip.shotCode}
            {clip.versionName && <span className="text-muted-foreground"> · {clip.versionName}</span>}
          </span>
        )}
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {formatTimecode(playback.time)} / {formatTimecode(timeline.totalDuration)}
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1 bg-black">
            {/* Les deux tampons restent montés en permanence : démonter celui qui sort
                annulerait le préchargement et ramènerait la coupure. */}
            <video
              ref={videoA}
              className={`absolute inset-0 h-full w-full object-contain ${
                playback.active === 'A' && !showPlaceholder ? '' : 'invisible'
              }`}
              playsInline
              crossOrigin="anonymous"
            />
            <video
              ref={videoB}
              className={`absolute inset-0 h-full w-full object-contain ${
                playback.active === 'B' && !showPlaceholder ? '' : 'invisible'
              }`}
              playsInline
              crossOrigin="anonymous"
            />
            {showPlaceholder && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                <FileWarning size={28} className="text-amber-500" />
                <span className="text-sm font-medium text-foreground">{clip?.shotCode}</span>
                <span className="text-xs">{t('timeline.noMedia')}</span>
              </div>
            )}
          </div>

          <div className="shrink-0 space-y-2 border-t border-border p-3">
            <TimelineScrubber
              items={items}
              total={timeline.totalDuration}
              time={playback.time}
              currentIndex={playback.index}
              onSeek={playback.seek}
            />
            <div className="flex items-center gap-3">
              <button
                onClick={playback.toggle}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground"
                title={playback.playing ? t('video.pauseKey') : t('video.playKey')}
              >
                {playback.playing ? <Pause size={16} /> : <Play size={16} />}
              </button>
              <span className="text-xs text-muted-foreground">
                {t('timeline.shotCount', { count: items.length })}
                {timeline.gapCount > 0 && ` · ${t('timeline.gapCount', { count: timeline.gapCount })}`}
              </span>
            </div>
          </div>
        </main>

        <TimelineComments clip={clip} localTime={clip ? localTimeAt(clip, playback.time) : 0} />
      </div>
    </div>
  );
}
