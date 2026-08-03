// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ListVideo } from 'lucide-react';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { reviewPath } from '../../lib/slug';
import type { PlaylistDetail, PlaylistItemEntry } from '../../types/api';
import { carryParams, findPlayableNeighbor } from './playlistNav';
import { useT } from '../../i18n';

/**
 * Lecture enchaînée d'une playlist (33.A) : actif quand la review est ouverte avec
 * `?playlist=ID`. Affiche nom + position (n/N) et navigue précédent/suivant vers le
 * premier média visible des versions voisines, en conservant le contexte d'URL.
 */
export default function PlaylistNavigator({ versionId }: { versionId: number }) {
  const t = useT();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const playlistId = Number(searchParams.get('playlist')) || 0;

  const playlistQ = useQuery({
    queryKey: qk.playlist(playlistId),
    queryFn: () =>
      api.get<{ playlist: PlaylistDetail }>(`/api/playlists/${playlistId}`).then((d) => d.playlist),
    enabled: playlistId > 0,
  });
  const playlist = playlistQ.data ?? null;
  if (!playlist) return null;

  const items = playlist.items;
  const idx = items.findIndex((it) => it.version.id === versionId);
  const prev = findPlayableNeighbor(items, idx, -1);
  const next = findPlayableNeighbor(items, idx, 1);
  const go = (item: PlaylistItemEntry | null) => {
    if (item?.media) navigate(reviewPath(item.media) + carryParams(searchParams));
  };

  return (
    <div
      className="flex shrink-0 items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-xs text-muted-foreground"
      title={t('playlist.named', { name: playlist.name })}
    >
      <ListVideo size={13} className="shrink-0" />
      <span className="max-w-32 truncate">{playlist.name}</span>
      <button
        disabled={!prev}
        onClick={() => go(prev)}
        title={
          prev
            ? t('playlist.previousNamed', { name: prev.version.location || prev.media?.originalName || '' })
            : t('playlist.start')
        }
        className="rounded p-1 hover:bg-secondary hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <ChevronLeft size={14} />
      </button>
      <span className="font-mono">{idx >= 0 ? `${idx + 1}/${items.length}` : `–/${items.length}`}</span>
      <button
        disabled={!next}
        onClick={() => go(next)}
        title={
          next
            ? t('playlist.nextNamed', { name: next.version.location || next.media?.originalName || '' })
            : t('playlist.end')
        }
        className="rounded p-1 hover:bg-secondary hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );
}
