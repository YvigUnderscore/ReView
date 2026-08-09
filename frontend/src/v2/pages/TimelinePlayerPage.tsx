// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, FileWarning } from 'lucide-react';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import { parseIdParam, projectPath } from '../lib/slug';
import Shell from '../components/Shell';
import { SkeletonRows } from '../components/ui/skeleton';
import ReviewWorkspace from './review/ReviewWorkspace';
import MontageTrack, { type MontageContext } from './review/MontageTrack';
import { clipIndexAt, localTimeAt, nextPlayableIndex } from './timeline/timelinePlayback';
import type { TimelineView } from '../types/api';
import { useT } from '../i18n';

/** Où l'on en est dans le film : quel plan, à quelle position, en lecture ou non. */
interface Cursor {
  index: number;
  startAt: number;
  autoPlay: boolean;
}

/**
 * Page du montage (Phase 46) : le film sur son propre écran, avec les outils de review.
 *
 * Ce n'est pas un lecteur à part : c'est la review habituelle appliquée au plan courant —
 * annotation sur l'image, commentaire à la frame, image par image, boucle, marqueurs,
 * comparaison A/B, salle live — avec la bande du montage entier sous le lecteur. La fin
 * d'un plan enchaîne sur le suivant, et cliquer dans la bande emmène ailleurs dans le film
 * sans quitter la page.
 */
export default function TimelinePlayerPage() {
  const t = useT();
  const { id } = useParams();
  const timelineId = parseIdParam(id);
  const [params] = useSearchParams();

  const timelineQ = useQuery({
    queryKey: qk.timeline(timelineId),
    queryFn: () =>
      api.get<{ timeline: TimelineView }>(`/api/timelines/${timelineId}`).then((d) => d.timeline),
    enabled: Number.isFinite(timelineId),
  });
  const timeline = timelineQ.data ?? null;
  const items = useMemo(() => timeline?.items ?? [], [timeline]);

  // Position d'entrée : `?t=` (secondes) donne le plan et l'endroit exact — c'est ce qui
  // fait qu'un clic sur la bande d'une carte de montage arrive au bon endroit du film.
  const [cursor, setCursor] = useState<Cursor | null>(null);
  if (!cursor && items.length > 0) {
    const at = Number(params.get('t')) || 0;
    const index = Math.max(0, clipIndexAt(items, at));
    setCursor({ index, startAt: localTimeAt(items[index]!, at), autoPlay: true });
  }

  const onSelectClip = useCallback(
    (index: number, localTime: number, play: boolean) =>
      setCursor({ index, startAt: localTime, autoPlay: play }),
    [],
  );

  // Enchaînement : le plan suivant démarre là où le précédent s'arrête. Les cartons sont
  // sautés à la lecture — un trou n'a rien à montrer — mais restent sur la bande, où l'on
  // peut les ouvrir : c'est là qu'on voit ce qui manque.
  const onEnded = useCallback(() => {
    setCursor((c) => {
      if (!c) return c;
      const next = nextPlayableIndex(items, c.index);
      return next < 0 ? c : { index: next, startAt: 0, autoPlay: true };
    });
  }, [items]);

  if (timelineQ.isLoading) return <SkeletonRows count={4} />;
  if (!timeline || !cursor) return <p className="p-6 text-sm text-destructive">{t('timeline.notFound')}</p>;

  const clip = items[cursor.index] ?? null;
  const montage: MontageContext = {
    timeline,
    index: cursor.index,
    startAt: cursor.startAt,
    autoPlay: cursor.autoPlay,
    onSelectClip,
    onEnded,
  };

  // Plan sans média : rien à reviewer, mais le montage reste navigable autour du trou.
  if (!clip || clip.mediaId === null) return <MontageGap timeline={timeline} montage={montage} />;

  // `key` : chaque plan repart d'une review propre (annotations, commentaires, lecteur).
  return (
    <ReviewWorkspace
      key={`${cursor.index}:${clip.mediaId}`}
      id={clip.mediaId}
      title={timeline.name ?? t('timeline.defaultName')}
      montage={montage}
    />
  );
}

/** Écran d'un carton : le trou occupe sa place, la bande reste là pour en sortir. */
function MontageGap({ timeline, montage }: { timeline: TimelineView; montage: MontageContext }) {
  const t = useT();
  const empty = useRef<HTMLVideoElement>(null);
  const clip = timeline.items[montage.index] ?? null;
  const next = nextPlayableIndex(timeline.items, montage.index);

  return (
    <Shell
      title={timeline.name ?? t('timeline.defaultName')}
      breadcrumb={
        <Link to={projectPath({ id: timeline.projectId })} className="hover:text-foreground">
          {t('common.back')}
        </Link>
      }
    >
      <div className="flex h-[calc(100vh-7rem)] flex-col gap-2">
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-border bg-card text-muted-foreground">
          <FileWarning size={30} className="text-amber-500" />
          <span className="text-sm font-medium text-foreground">{clip?.shotCode}</span>
          <span className="text-xs">{t('timeline.noMedia')}</span>
          {next >= 0 && (
            <button
              onClick={() => montage.onSelectClip(next, 0, true)}
              className="mt-2 flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
            >
              {t('timeline.nextShot')} <ChevronRight size={13} />
            </button>
          )}
        </div>
        <MontageTrack montage={montage} videoRef={empty} />
      </div>
    </Shell>
  );
}
