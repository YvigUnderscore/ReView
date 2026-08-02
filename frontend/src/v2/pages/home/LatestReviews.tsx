// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router-dom';
import { MessageSquare, Clapperboard } from 'lucide-react';
import { timeAgo } from '../../lib/time';
import { reviewPath } from '../../lib/slug';
import { MEDIA_KIND_ICON } from '../task/taskTypes';
import type { DashboardReview } from './homeTypes';

/** Timecode mm:ss du commentaire (temps vidéo en secondes). */
function tc(s: number): string {
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function Thumb({ review, large = false }: { review: DashboardReview; large?: boolean }) {
  const Icon = MEDIA_KIND_ICON[review.kind];
  if (review.thumbnailUrl)
    return (
      <img
        src={review.thumbnailUrl}
        alt=""
        className={`${large ? 'aspect-video w-full' : 'h-14 w-24 shrink-0'} rounded-md object-cover`}
      />
    );
  return (
    <div
      className={`${large ? 'aspect-video w-full' : 'h-14 w-24 shrink-0'} flex items-center justify-center rounded-md bg-muted text-muted-foreground`}
    >
      <Icon size={large ? 40 : 20} />
    </div>
  );
}

function CommentLine({ review }: { review: DashboardReview }) {
  const c = review.lastComment;
  return (
    <p className="flex min-w-0 items-baseline gap-1.5 text-xs text-muted-foreground">
      <MessageSquare size={12} className="shrink-0 translate-y-px" />
      <span className="truncate">
        <span className="font-medium text-foreground">{c.author ?? 'Invité'}</span>
        {c.timestamp != null && <span className="ml-1 text-primary">@ {tc(c.timestamp)}</span>}
        <span className="ml-1">« {c.content} »</span>
      </span>
      <span className="ml-auto shrink-0">{timeAgo(c.createdAt)}</span>
    </p>
  );
}

/** Hero « Dernières reviews » : dernier média commenté en grand + reviews récentes. */
export default function LatestReviews({ reviews }: { reviews: DashboardReview[] }) {
  const [hero, ...rest] = reviews;
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Dernières reviews
      </h2>
      {!hero ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
          <Clapperboard size={28} />
          Aucune review commentée pour l'instant — publiez un média et lancez la discussion.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Link
            to={reviewPath({ id: hero.mediaId, originalName: hero.name })}
            className="group block overflow-hidden rounded-md border border-border transition-colors hover:border-primary/60"
          >
            <Thumb review={hero} large />
            <div className="space-y-1.5 p-3">
              <p className="truncate text-sm font-medium group-hover:text-primary">
                {hero.name}
                <span className="ml-2 font-normal text-muted-foreground">
                  {hero.location && `${hero.location} · `}
                  {hero.versionName}
                </span>
              </p>
              <CommentLine review={hero} />
            </div>
          </Link>
          <div className="space-y-2">
            {rest.length === 0 && (
              <p className="px-1 py-2 text-xs text-muted-foreground">Pas d'autre review récente.</p>
            )}
            {rest.map((r) => (
              <Link
                key={r.mediaId}
                to={reviewPath({ id: r.mediaId, originalName: r.name })}
                className="group flex items-center gap-3 rounded-md border border-border p-2 transition-colors hover:border-primary/60"
              >
                <Thumb review={r} />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="truncate text-sm font-medium group-hover:text-primary">
                    {r.name}
                    <span className="ml-2 font-normal text-muted-foreground">
                      {r.location && `${r.location} · `}
                      {r.versionName}
                    </span>
                  </p>
                  <CommentLine review={r} />
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
