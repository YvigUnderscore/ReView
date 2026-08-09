// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MessageSquare, Maximize2, Minimize2, Pause, Play } from 'lucide-react';
import TimelineTrack from './TimelineTrack';
import { formatTimecode } from './timelinePlayback';
import type { TimelineView } from '../../types/api';
import { useT } from '../../i18n';

/** Commandes qui appartiennent au montage entier, pas à la lecture d'un plan. */
export interface PlayerChrome {
  comments: boolean;
  toggleComments: () => void;
  fullscreen: boolean;
  toggleFullscreen: () => void;
}

/**
 * La bande du montage et ses commandes (Phase 46).
 *
 * Le même bloc sert avant et pendant la lecture : la bande ne dépend pas du fait qu'un
 * film soit en train de jouer, et un montage à l'arrêt reste un montage qu'on doit voir
 * en entier. C'est aussi ce qui permet de cliquer un plan pour démarrer là.
 */
export default function TimelineDeck({
  timeline,
  time,
  currentIndex,
  playing,
  onToggle,
  onSeek,
  chrome,
}: {
  timeline: TimelineView;
  time: number;
  currentIndex: number;
  playing: boolean;
  onToggle: () => void;
  onSeek: (t: number) => void;
  chrome: PlayerChrome;
}) {
  const t = useT();
  const clip = timeline.items[currentIndex] ?? null;

  return (
    <div className="shrink-0 space-y-1.5">
      <TimelineTrack
        items={timeline.items}
        total={timeline.totalDuration}
        time={time}
        currentIndex={currentIndex}
        onSeek={onSeek}
        timelineId={timeline.id}
      />
      <div className="flex items-center gap-2">
        <button
          onClick={onToggle}
          title={playing ? t('timeline.pause') : t('timeline.play')}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
        >
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        {/* Libellé permanent : on sait en continu où l'on se trouve dans le film. */}
        <span className="min-w-0 truncate text-xs">
          <span className="text-muted-foreground">{clip?.sequenceCode ?? '—'}</span>
          {clip && ` · ${clip.shotCode}`}
          {clip?.versionName && <span className="text-muted-foreground"> · {clip.versionName}</span>}
        </span>
        <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
          {formatTimecode(time)} / {formatTimecode(timeline.totalDuration)}
        </span>
        <button
          onClick={chrome.toggleComments}
          title={t('comments.title')}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border ${
            chrome.comments ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60'
          }`}
        >
          <MessageSquare size={14} />
        </button>
        <button
          onClick={chrome.toggleFullscreen}
          title={chrome.fullscreen ? t('timeline.exitFullscreen') : t('timeline.fullscreen')}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border text-muted-foreground hover:bg-secondary/60"
        >
          {chrome.fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </div>
    </div>
  );
}
