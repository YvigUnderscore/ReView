// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Play, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { itemPath } from '../review/playlistNav';
import type { PlaylistDetail, PlaylistItemEntry } from '../../types/api';
import ReviewDecisionBadge from '../../components/ReviewDecisionBadge';
import { Skeleton } from '../../components/ui/skeleton';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '../../components/ui/context-menu';

/** Items ordonnés d'une playlist dépliée : clic → review enchaînée ; clic droit → ordre/retrait. */
export default function PlaylistItems({
  playlistId,
  canEdit,
  onChanged,
}: {
  playlistId: number;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const detailQ = useQuery({
    queryKey: qk.playlist(playlistId),
    queryFn: () =>
      api.get<{ playlist: PlaylistDetail }>(`/api/playlists/${playlistId}`).then((d) => d.playlist),
  });
  const items = detailQ.data?.items ?? [];

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.playlist(playlistId) });
    onChanged();
  };

  const move = async (index: number, delta: -1 | 1) => {
    const ids = items.map((it) => it.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    try {
      await api.patch(`/api/playlists/${playlistId}`, { itemIds: ids });
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erreur');
    }
  };

  const removeItem = async (item: PlaylistItemEntry) => {
    try {
      await api.del(`/api/playlists/${playlistId}/items/${item.id}`);
      toast.success('Version retirée de la playlist');
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erreur');
    }
  };

  if (detailQ.isLoading) return <Skeleton className="mx-3 mb-3 h-10" />;
  if (items.length === 0)
    return <p className="border-t border-border px-3 py-3 text-xs text-muted-foreground">Playlist vide.</p>;

  return (
    <ol className="border-t border-border">
      {items.map((it, i) => {
        const path = itemPath(it, playlistId);
        return (
          <ContextMenu key={it.id}>
            <ContextMenuTrigger asChild>
              <li
                onClick={() =>
                  path ? navigate(path) : toast.error('Aucun média lisible pour cette version')
                }
                className="flex cursor-pointer items-center gap-3 border-b border-border/50 px-3 py-1.5 text-sm last:border-b-0 hover:bg-secondary/50"
              >
                <span className="w-5 shrink-0 text-right font-mono text-xs text-muted-foreground">
                  {i + 1}
                </span>
                {it.media?.thumbnailUrl ? (
                  <img
                    src={it.media.thumbnailUrl}
                    alt=""
                    className="h-8 w-14 shrink-0 rounded object-cover"
                  />
                ) : (
                  <span className="h-8 w-14 shrink-0 rounded bg-secondary" />
                )}
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{it.version.location || it.media?.originalName}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{it.version.name}</span>
                </span>
                {it.version.reviewStatus && <ReviewDecisionBadge status={it.version.reviewStatus} />}
              </li>
            </ContextMenuTrigger>
            <ContextMenuContent>
              {path && (
                <ContextMenuItem onClick={() => navigate(path)}>
                  <Play size={14} /> Ouvrir en review
                </ContextMenuItem>
              )}
              {canEdit && (
                <>
                  <ContextMenuItem onClick={() => void move(i, -1)}>
                    <ArrowUp size={14} /> Monter
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => void move(i, 1)}>
                    <ArrowDown size={14} /> Descendre
                  </ContextMenuItem>
                  <ContextMenuItem danger onClick={() => void removeItem(it)}>
                    <X size={14} /> Retirer de la playlist
                  </ContextMenuItem>
                </>
              )}
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
    </ol>
  );
}
