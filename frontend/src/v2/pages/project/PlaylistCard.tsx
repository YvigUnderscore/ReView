// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router-dom';
import { ListVideo, Play, Radio } from 'lucide-react';
import { timeAgo } from '../../lib/time';
import type { PlaylistSummary } from '../../types/api';
import { useT } from '../../i18n';

/**
 * A playlist, as a card.
 *
 * It used to be a line of text: "Dailies Tuesday · 12 versions · 2 h ago". Yet a dailies list is
 * identified by what it contains, not by its name: "Dailies Tuesday" and "Dailies Wednesday" can
 * only be told apart by the image. The strip of the first four thumbnails settles the question at
 * a glance.
 *
 * The play button is the main gesture: one opens a playlist to watch it. It covers the image on
 * hover rather than taking up a column, so the card stays dense.
 */
export default function PlaylistCard({
  playlist,
  live,
  onPlay,
}: {
  playlist: PlaylistSummary;
  /** Live session currently running on this playlist, if any. */
  live: { participantCount: number } | null;
  onPlay: (joinLive: boolean) => void;
}) {
  const t = useT();
  const previews = playlist.previews ?? [];

  return (
    <div className="group overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-primary">
      <Link to={`/playlists/${playlist.id}`} className="block">
        <div className="relative flex h-24 gap-px bg-secondary/40">
          {previews.length === 0 ? (
            <span className="flex flex-1 items-center justify-center text-muted-foreground">
              <ListVideo size={22} />
            </span>
          ) : (
            previews.map((url, i) => (
              <img
                key={i}
                src={url}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-full min-w-0 flex-1 object-cover"
              />
            ))
          )}
          {/* Playback: on hover, over the strip. A dedicated column would have cost the width
              used to show the images. */}
          <button
            onClick={(e) => {
              e.preventDefault();
              onPlay(false);
            }}
            title={t('playlist.play')}
            aria-label={t('playlist.play')}
            className="absolute inset-0 flex items-center justify-center bg-background/60 opacity-0 transition-opacity group-hover:opacity-100"
          >
            <span className="rounded-full bg-primary p-2.5 text-primary-foreground">
              <Play size={18} />
            </span>
          </button>
        </div>
      </Link>

      <div className="flex items-center gap-2 px-3 py-2">
        <Link to={`/playlists/${playlist.id}`} className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{playlist.name}</span>
          <span className="block truncate text-2xs text-muted-foreground">
            {t('playlists.versionCount', { count: playlist._count.items })}
            {playlist.createdBy?.name ? ` · ${playlist.createdBy.name}` : ''} · {timeAgo(playlist.updatedAt)}
          </span>
        </Link>
        {live && (
          <button
            onClick={() => onPlay(true)}
            title={`${t('live.running')} ${t('live.participants', { count: live.participantCount })} ${t('live.clickToJoin')}`}
            className="flex shrink-0 items-center gap-1 rounded-md border border-accent2/60 bg-accent2/10 px-1.5 py-0.5 text-2xs font-semibold text-accent2 hover:bg-accent2/20"
          >
            <Radio size={11} className="animate-pulse" /> {t('live.badge')} · {live.participantCount}
          </button>
        )}
      </div>
    </div>
  );
}
