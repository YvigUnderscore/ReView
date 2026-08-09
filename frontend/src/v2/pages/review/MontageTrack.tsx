// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState, type RefObject } from 'react';
import { Clapperboard } from 'lucide-react';
import TimelineTrack from '../timeline/TimelineTrack';
import { clipIndexAt, formatTimecode, localTimeAt } from '../timeline/timelinePlayback';
import type { TimelineView } from '../../types/api';
import { useT } from '../../i18n';

/** Ce que la review a besoin de savoir du montage qui l'englobe. */
export interface MontageContext {
  timeline: TimelineView;
  /** Plan à l'écran. */
  index: number;
  /** Position d'entrée dans ce plan, en secondes. */
  startAt: number;
  /** Le film était en lecture : ce plan enchaîne tout seul. */
  autoPlay: boolean;
  /** Aller à un autre plan du montage, à une position donnée. */
  onSelectClip: (index: number, localTime: number, play: boolean) => void;
  /** Fin du plan courant : passer au suivant. */
  onEnded: () => void;
}

/**
 * La bande du montage sous le lecteur de review (Phase 46).
 *
 * Le film entier y est, les plans les uns à la suite des autres et chacun large de sa
 * durée : on voit d'où l'on vient et où l'on va sans quitter l'écran. Cliquer dedans
 * charge le plan visé dans cette même review — donc avec les mêmes outils, plutôt que dans
 * un lecteur à part qui n'en aurait aucun.
 */
export default function MontageTrack({
  montage,
  videoRef,
  videoReady = false,
}: {
  montage: MontageContext;
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Le lecteur existe : avant, il n'y a qu'un squelette et rien à écouter. */
  videoReady?: boolean;
}) {
  const t = useT();
  const items = montage.timeline.items;
  const clip = items[montage.index] ?? null;
  const [time, setTime] = useState(clip?.startTime ?? 0);

  // La tête de lecture suit la vidéo du plan courant, décalée de son début dans le film.
  // `timeupdate` (~4 Hz) suffit à une bande : le repérage à la frame se fait sur la
  // timeline du lecteur, juste au-dessus. `videoReady` est en dépendance parce que
  // l'élément vidéo n'existe pas encore au premier rendu — sans lui, la tête de lecture
  // resterait plantée au début du plan.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !clip) return;
    const sync = () => setTime(clip.startTime + Math.min(video.currentTime, clip.duration));
    video.addEventListener('timeupdate', sync);
    video.addEventListener('seeked', sync);
    return () => {
      video.removeEventListener('timeupdate', sync);
      video.removeEventListener('seeked', sync);
    };
  }, [videoRef, clip, videoReady]);

  const seek = (target: number) => {
    const index = clipIndexAt(items, target);
    const wanted = items[index];
    if (!wanted) return;
    const local = localTimeAt(wanted, target);
    const video = videoRef.current;
    // Déplacement à l'intérieur du plan déjà chargé : inutile d'en changer.
    if (index === montage.index && video) {
      video.currentTime = local;
      setTime(target);
      return;
    }
    montage.onSelectClip(index, local, !!video && !video.paused);
  };

  return (
    <div className="shrink-0">
      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
        <Clapperboard size={13} className="text-primary" />
        <span className="font-medium text-foreground">
          {montage.timeline.name ?? t('timeline.defaultName')}
        </span>
        <span>{t('timeline.shotCount', { count: items.length })}</span>
        <span className="ml-auto tabular-nums">
          {formatTimecode(time)} / {formatTimecode(montage.timeline.totalDuration)}
        </span>
      </div>
      <TimelineTrack
        items={items}
        total={montage.timeline.totalDuration}
        time={time}
        currentIndex={montage.index}
        onSeek={seek}
        timelineId={montage.timeline.id}
        linkToReview={false}
      />
    </div>
  );
}
