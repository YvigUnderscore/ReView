// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router-dom';
import { Clapperboard, EyeOff } from 'lucide-react';
import PipelineStatusBadge from '../../components/shotgrid/PipelineStatusBadge';
import EmptyState from '../../components/ui/empty-state';
import type { SequenceDetailData } from '../project/projectTypes';
import { useT } from '../../i18n';

/**
 * Les plans d'une séquence, en grille (C3).
 *
 * L'accordéon les affichait en pastilles de texte : on lisait des codes, jamais l'image
 * ni l'avancement. Une grille de vignettes répond à ce qu'on vient chercher — où en est
 * la scène — et chaque tuile mène au plan.
 */
export default function SequenceShotGrid({ shots }: { shots: SequenceDetailData['shots'] }) {
  const t = useT();

  if (shots.length === 0) {
    return <EmptyState compact icon={Clapperboard} title={t('sequences.noShot')} />;
  }

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
        {t('shots.title')} ({shots.length})
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {shots.map((shot) => (
          <Link
            key={shot.id}
            to={`/shots/${shot.id}`}
            className="group flex flex-col overflow-hidden rounded-lg border border-border transition-colors hover:border-primary"
          >
            <span className="relative block aspect-video w-full overflow-hidden bg-muted">
              {shot.thumbnailUrl ? (
                <img
                  src={shot.thumbnailUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-muted-foreground">
                  <Clapperboard size={22} />
                </span>
              )}
              {/* Un plan coupé au montage reste consultable : il se signale, il ne disparaît pas. */}
              {shot.omitted && (
                <span
                  title={t('shots.omitted')}
                  className="absolute right-1.5 top-1.5 rounded bg-background/80 p-1 text-muted-foreground"
                >
                  <EyeOff size={12} />
                </span>
              )}
            </span>
            <span className="flex flex-col gap-1 p-2">
              <span className="flex items-center justify-between gap-1">
                <span className="truncate text-sm font-medium group-hover:text-primary">{shot.code}</span>
                <PipelineStatusBadge statusId={shot.pipelineStatusId} scope="shot" size="xs" />
              </span>
              <span className="flex items-center justify-between gap-2 text-2xs text-muted-foreground">
                <span className="truncate">{shot.name !== shot.code ? shot.name : ''}</span>
                {shot._count && shot._count.tasks > 0 && (
                  <span className="shrink-0 tabular-nums">
                    {t('sequence.taskCount', { count: shot._count.tasks })}
                  </span>
                )}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
