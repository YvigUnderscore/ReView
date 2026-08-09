// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import TimelineDeck, { type PlayerChrome } from './TimelineDeck';
import TimelineStage from './TimelineStage';
import type { TimelineView } from '../../types/api';
import { useT } from '../../i18n';

/**
 * Le montage, joué là où il est (Phase 46).
 *
 * Rien n'emmène ailleurs : la bande, l'image et les retours tiennent dans la carte du
 * montage. Le plein écran passe par l'API du navigateur sur ce même bloc, donc sans
 * changer de page non plus — ouvrir un lecteur séparé aurait rendu au montage le statut
 * d'annexe qu'on cherchait justement à lui retirer.
 */
export default function TimelinePlayer({ timeline }: { timeline: TimelineView }) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  // Position d'entrée dans le film ; `null` tant que personne n'a demandé à le voir.
  const [startAt, setStartAt] = useState<number | null>(null);
  const [comments, setComments] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  // L'état de plein écran appartient au navigateur : la touche Échap en sort sans passer
  // par notre bouton, et l'icône doit suivre.
  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === box.current);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  const chrome: PlayerChrome = {
    comments,
    toggleComments: () => setComments((v) => !v),
    fullscreen,
    toggleFullscreen: () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void box.current?.requestFullscreen().catch(() => undefined);
    },
  };

  const poster = timeline.items.find((it) => it.thumbnailUrl) ?? null;

  return (
    <div
      ref={box}
      className={`flex flex-col gap-1.5 ${fullscreen ? 'h-full bg-background p-3' : ''}`}
      data-testid="timeline-player"
    >
      {startAt === null ? (
        <>
          <button
            onClick={() => setStartAt(0)}
            className={`relative flex w-full items-center justify-center overflow-hidden rounded border border-border bg-black ${
              fullscreen ? 'flex-1' : 'aspect-video max-h-[55vh]'
            }`}
          >
            {poster?.thumbnailUrl && (
              <img
                src={poster.thumbnailUrl}
                alt=""
                className="absolute inset-0 h-full w-full object-cover opacity-40"
              />
            )}
            <span className="relative flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              <Play size={16} /> {t('timeline.play')}
            </span>
          </button>
          {/* Cliquer un plan de la bande démarre le film à cet endroit. */}
          <TimelineDeck
            timeline={timeline}
            time={0}
            currentIndex={-1}
            playing={false}
            onToggle={() => setStartAt(0)}
            onSeek={setStartAt}
            chrome={chrome}
          />
        </>
      ) : (
        <TimelineStage timeline={timeline} startAt={startAt} chrome={chrome} />
      )}
    </div>
  );
}
