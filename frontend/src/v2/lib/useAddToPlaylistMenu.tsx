// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { ListVideo } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import { qk } from './query';
import { usePlaylists } from './playlistApi';
import type { MenuEntry } from './menuSpec';
import { useT } from '../i18n';

/**
 * "Add to playlist" entry for any context menu (C5).
 *
 * Adding existed only from a media item's review. A supervisor browsing their
 * shots, assets or kanban wants to push what they see into the evening dailies
 * without changing screens: the submenu lists the project's playlists, and the server knows
 * how to resolve a media item as a version.
 *
 * The target may be deferred: on a sequence, "add" means "the latest published
 * version of each of its shots", which is only fetched on click — not when the
 * page opens, for a menu entry that nobody may use.
 */

export interface PlaylistTarget {
  versionIds?: number[];
  mediaIds?: number[];
}

export function useAddToPlaylistMenu(projectId: number) {
  const t = useT();
  const qc = useQueryClient();
  const { data: playlists = [] } = usePlaylists(projectId);

  const entry = (target: PlaylistTarget | (() => Promise<PlaylistTarget>)): MenuEntry | null => {
    if (playlists.length === 0) return null;
    return {
      kind: 'submenu',
      id: 'add-to-playlist',
      label: t('playlist.addTo'),
      icon: <ListVideo size={14} />,
      items: playlists.map((p) => ({
        id: `playlist-${p.id}`,
        label: p.name,
        onSelect: () => {
          void (async () => {
            try {
              const resolved = typeof target === 'function' ? await target() : target;
              const count = (resolved.versionIds?.length ?? 0) + (resolved.mediaIds?.length ?? 0);
              if (count === 0) {
                toast.error(t('playlist.nothingToAdd'));
                return;
              }
              const r = await api.post<{ added: number; skipped: number }>(
                `/api/playlists/${p.id}/items`,
                resolved,
              );
              toast.success(
                r.added > 0
                  ? t('playlist.addedTo', { name: p.name, count: r.added })
                  : t('playlist.alreadyThere'),
              );
              void qc.invalidateQueries({ queryKey: qk.playlist(p.id) });
              void qc.invalidateQueries({ queryKey: qk.playlists(projectId) });
            } catch (e) {
              toast.error(e instanceof Error ? e.message : t('common.error.generic'));
            }
          })();
        },
      })),
    };
  };

  return { entry, hasPlaylists: playlists.length > 0 };
}
