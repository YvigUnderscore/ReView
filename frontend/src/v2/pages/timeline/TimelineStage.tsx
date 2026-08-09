// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef } from 'react';
import { FileWarning } from 'lucide-react';
import TimelineComments from './TimelineComments';
import TimelineDeck, { type PlayerChrome } from './TimelineDeck';
import { useContinuousPlayback } from './useContinuousPlayback';
import { localTimeAt } from './timelinePlayback';
import type { TimelineView } from '../../types/api';
import { useT } from '../../i18n';

/**
 * Le film en cours de lecture, à sa place dans la page (Phase 46).
 *
 * Deux lecteurs vidéo se relaient : pendant que l'un joue, l'autre charge le plan suivant,
 * et la bascule n'est qu'un échange de visibilité. Les repères de plan et de séquence
 * vivent sur la bande et dans le bandeau, jamais sur l'image — c'est le sens de « aucune
 * interruption », d'un plan au suivant comme d'une séquence à la suivante.
 *
 * Ce composant n'est monté qu'après un geste de lecture : tant qu'il ne l'est pas, aucun
 * média n'est téléchargé pour une page qu'on ne fait que traverser.
 */
export default function TimelineStage({
  timeline,
  startAt,
  chrome,
}: {
  timeline: TimelineView;
  startAt: number;
  chrome: PlayerChrome;
}) {
  const t = useT();
  const videoA = useRef<HTMLVideoElement | null>(null);
  const videoB = useRef<HTMLVideoElement | null>(null);
  const playback = useContinuousPlayback(timeline.items, videoA, videoB, startAt);
  const { clip } = playback;
  const showCard = clip !== null && clip.mediaId === null;

  return (
    <>
      <div
        className={`flex min-h-0 overflow-hidden rounded border border-border ${chrome.fullscreen ? 'flex-1' : ''}`}
      >
        <div
          className={`relative min-w-0 flex-1 bg-black ${chrome.fullscreen ? '' : 'aspect-video max-h-[55vh]'}`}
        >
          {/* Les deux tampons restent montés en permanence : démonter celui qui sort
              annulerait le préchargement et ramènerait la coupure. */}
          <video
            ref={videoA}
            className={`absolute inset-0 h-full w-full object-contain ${
              playback.active === 'A' && !showCard ? '' : 'invisible'
            }`}
            playsInline
            crossOrigin="anonymous"
          />
          <video
            ref={videoB}
            className={`absolute inset-0 h-full w-full object-contain ${
              playback.active === 'B' && !showCard ? '' : 'invisible'
            }`}
            playsInline
            crossOrigin="anonymous"
          />
          {showCard && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
              <FileWarning size={28} className="text-amber-500" />
              <span className="text-sm font-medium text-foreground">{clip?.shotCode}</span>
              <span className="text-xs">{t('timeline.noMedia')}</span>
            </div>
          )}
        </div>
        {chrome.comments && (
          <TimelineComments clip={clip} localTime={clip ? localTimeAt(clip, playback.time) : 0} />
        )}
      </div>

      <TimelineDeck
        timeline={timeline}
        time={playback.time}
        currentIndex={playback.index}
        playing={playback.playing}
        onToggle={playback.toggle}
        onSeek={playback.seek}
        chrome={chrome}
      />
    </>
  );
}
