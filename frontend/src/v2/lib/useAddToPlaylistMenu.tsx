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
 * Entrée « Ajouter à la playlist » pour n'importe quel menu contextuel (C5).
 *
 * L'ajout n'existait que depuis la review d'un média. Un superviseur qui parcourt ses
 * plans, ses assets ou son kanban veut pousser ce qu'il voit dans les dailies du soir
 * sans changer d'écran : le sous-menu liste les playlists du projet, et le serveur sait
 * résoudre un média comme une version.
 *
 * La cible peut être différée : sur une séquence, « ajouter » signifie « la dernière
 * version publiée de chacun de ses plans », que l'on ne va chercher qu'au clic — pas à
 * l'ouverture de la page, pour une entrée de menu que personne n'utilisera peut-être.
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
