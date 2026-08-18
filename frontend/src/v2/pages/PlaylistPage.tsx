// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Pencil, Play } from 'lucide-react';
import { toast } from 'sonner';
import PageShell from '../components/PageShell';
import EntityBreadcrumb from '../components/EntityBreadcrumb';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { SkeletonRows } from '../components/ui/skeleton';
import PlaylistCatalog from './playlist/PlaylistCatalog';
import PlaylistContent from './playlist/PlaylistContent';
import { itemPath } from './review/playlistNav';
import {
  useAddToPlaylist,
  usePlaylist,
  useRemoveFromPlaylist,
  useRenamePlaylist,
  useReorderPlaylist,
} from '../lib/playlistApi';
import { useProjectRole } from '../lib/useProjectRole';
import { useAuth } from '../stores/useAuth';
import { parseIdParam } from '../lib/slug';
import { useT } from '../i18n';

/**
 * Page d'une playlist (C5) : le catalogue du projet à gauche, la playlist à droite.
 *
 * La playlist était une ligne dépliable dans un onglet, et l'on n'y ajoutait rien depuis
 * là : il fallait ouvrir chaque plan un par un pour y cliquer « ajouter ». Les deux
 * panneaux côte à côte font de la construction d'une playlist de dailies un seul geste.
 */
export default function PlaylistPage() {
  const t = useT();
  const { id } = useParams();
  const playlistId = parseIdParam(id);
  const navigate = useNavigate();
  const playlistQ = usePlaylist(playlistId);
  const playlist = playlistQ.data ?? null;
  const projectId = playlist?.projectId ?? 0;

  const userId = useAuth((s) => s.user?.id);
  const { canManage, canContribute } = useProjectRole(projectId);
  // Même règle que le serveur : le créateur, ou qui gère le projet.
  const canEdit = canManage || (canContribute && playlist?.createdBy?.id === userId);

  const add = useAddToPlaylist(playlistId, projectId);
  const removeItem = useRemoveFromPlaylist(playlistId, projectId);
  const reorder = useReorderPlaylist(playlistId, projectId);
  const rename = useRenamePlaylist(playlistId, projectId);
  const [editingName, setEditingName] = useState<string | null>(null);

  const busy = add.isPending || removeItem.isPending || reorder.isPending;
  const presentVersionIds = useMemo(
    () => new Set((playlist?.items ?? []).map((it) => it.version.id)),
    [playlist],
  );

  const fail = (err: unknown) => toast.error(err instanceof Error ? err.message : t('common.error.generic'));

  const onAdd = (versionIds: number[]) => {
    if (versionIds.length === 0) return;
    add.mutate(versionIds, {
      onSuccess: (r) => toast.success(t('playlist.addedCount', { count: r.added })),
      onError: fail,
    });
  };

  const playFirst = () => {
    const first = (playlist?.items ?? []).map((it) => itemPath(it, playlistId)).find(Boolean);
    if (first) void navigate(first);
    else toast.error(t('task.noPlayableMedia'));
  };

  const saveName = () => {
    const next = (editingName ?? '').trim();
    setEditingName(null);
    if (!next || next === playlist?.name) return;
    rename.mutate(next, { onError: fail });
  };

  return (
    <PageShell
      breadcrumb={<EntityBreadcrumb entity="project" id={projectId} tail={playlist?.name ?? ''} />}
      width="fluid"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {editingName !== null ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveName();
            }}
          >
            <Input
              autoFocus
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => e.key === 'Escape' && setEditingName(null)}
              className="h-9 w-64"
            />
          </form>
        ) : (
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">{playlist?.name ?? t('playlist.title')}</h1>
            {canEdit && playlist && (
              <button
                onClick={() => setEditingName(playlist.name)}
                title={t('playlist.rename')}
                aria-label={t('playlist.rename')}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <Pencil size={15} />
              </button>
            )}
          </div>
        )}
        <Button size="sm" onClick={playFirst} disabled={!playlist || playlist.items.length === 0}>
          <Play size={15} /> {t('playlist.play')}
        </Button>
      </div>

      {playlistQ.error && <p className="mb-4 text-sm text-destructive">{playlistQ.error.message}</p>}

      {!playlist ? (
        <SkeletonRows count={5} />
      ) : (
        <div className="grid min-h-[60vh] gap-4 lg:grid-cols-2">
          {canEdit ? (
            <PlaylistCatalog
              projectId={projectId}
              presentVersionIds={presentVersionIds}
              onAdd={onAdd}
              busy={busy}
            />
          ) : (
            <div className="hidden" />
          )}
          <PlaylistContent
            playlist={playlist}
            canEdit={!!canEdit}
            busy={busy}
            onReorder={(ids) => reorder.mutate(ids, { onError: fail })}
            onRemove={(itemId) => removeItem.mutate(itemId, { onError: fail })}
          />
        </div>
      )}
    </PageShell>
  );
}
