// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Film, Image as ImageIcon, Box, Sparkles } from 'lucide-react';
import type { ClientMedia, MediaKind } from '../../types/api';
import { useT } from '../../i18n';

/**
 * Tile grid of the public page: the only place a media is displayed, whatever path leads
 * there (home, playlist, sequence, shot, asset). Tree nodes only carry identifiers; this is
 * where they turn back into images.
 */

const kindIcon: Record<MediaKind, React.ReactNode> = {
  VIDEO: <Film size={26} />,
  IMAGE: <ImageIcon size={26} />,
  MODEL_3D: <Box size={26} />,
  SPLAT: <Sparkles size={26} />,
};

/** Thumbnail of a tile, or the icon of its type when the pipeline produced none. */
export function MediaThumb({ media }: { media: ClientMedia | null }) {
  return (
    <div className="flex aspect-video items-center justify-center overflow-hidden bg-black/50 text-muted-foreground">
      {media?.thumbnailUrl ? (
        <img
          src={media.thumbnailUrl}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover transition-transform group-hover:scale-105"
        />
      ) : (
        ((media && kindIcon[media.kind]) ?? <Film size={26} />)
      )}
    </div>
  );
}

export const GRID_CLASS = 'grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5';

/** Situates a delivery under its filename: the task, then the version. */
const subtitleOf = (m: ClientMedia): string =>
  m.version.taskName ? `${m.version.taskName} · ${m.version.name}` : m.version.name;

export default function ClientMediaGrid({
  media,
  onOpen,
  view = 'grid',
  empty,
}: {
  media: readonly ClientMedia[];
  onOpen: (media: ClientMedia) => void;
  /** Compact list: one row per media, to scan a hundred shots without scrolling. */
  view?: 'grid' | 'list';
  /** Empty-state message: "nothing shared here" is not "nothing matches". */
  empty?: string;
}) {
  const t = useT();
  if (media.length === 0)
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">{empty ?? t('client.nothingHere')}</p>
    );

  if (view === 'list')
    return (
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        {media.map((m) => (
          <li key={m.id}>
            <button
              onClick={() => onOpen(m)}
              className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-secondary/50"
            >
              <span className="w-20 shrink-0 overflow-hidden rounded">
                <MediaThumb media={m} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs">{m.originalName}</span>
                <span className="block truncate text-2xs text-muted-foreground">{subtitleOf(m)}</span>
              </span>
              {m.decided && (
                <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-2xs text-muted-foreground">
                  {t('client.answered')}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    );

  return (
    <div className={GRID_CLASS}>
      {media.map((m) => (
        <button
          key={m.id}
          onClick={() => onOpen(m)}
          className="group relative overflow-hidden rounded-lg border border-border bg-card text-left transition-colors hover:border-primary/60"
        >
          <MediaThumb media={m} />
          {m.decided && (
            <span className="absolute right-1.5 top-1.5 rounded bg-background/85 px-1.5 py-0.5 text-2xs text-muted-foreground backdrop-blur">
              {t('client.answered')}
            </span>
          )}
          <div className="px-2.5 py-2">
            <p className="truncate text-xs">{m.originalName}</p>
            {/* The version name and the task name locate the delivery: without them, a grid of three
                "comp.mov" files does not say which one is the latest. */}
            <p className="truncate text-2xs text-muted-foreground">{subtitleOf(m)}</p>
          </div>
        </button>
      ))}
    </div>
  );
}
