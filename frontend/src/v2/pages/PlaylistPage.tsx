// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Pencil, Play } from 'lucide-react';
import { toast } from 'sonner';
import PageShell from '../components/PageShell';
import EntityBreadcrumb from '../components/EntityBreadcrumb';
import EntityContextMenu from '../components/ui/entity-menu';
import { useNotesExportEntry } from '../lib/useNotesExportMenu';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { SkeletonRows } from '../components/ui/skeleton';
import PlaylistCatalog from './playlist/PlaylistCatalog';
import PlaylistContent from './playlist/PlaylistContent';
import { itemPath } from './review/playlistNav';
import { useAddToPlaylist, usePlaylist } from '../lib/playlistApi';
import { usePlaylistUndo } from './playlist/usePlaylistUndo';
import type { PlaylistItemEntry } from '../types/api';
import { useProjectRole } from '../lib/useProjectRole';
import { useAuth } from '../stores/useAuth';
import { parseIdParam } from '../lib/slug';
import { useT } from '../i18n';

/**
 * Playlist page (C5): the project catalogue on the left, the playlist on the right.
 *
 * The playlist used to be a collapsible row in a tab, and nothing could be added to it
 * from there: one had to open each shot one by one to click "add". The two
 * panels side by side make building a dailies playlist a single gesture.
 */
/** Stable empty list: the editing hook must not see a new array on each render. */
const EMPTY_ITEMS: PlaylistItemEntry[] = [];

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
  // Same rule as the server: the creator, or whoever manages the project.
  const canEdit = canManage || (canContribute && playlist?.createdBy?.id === userId);

  const add = useAddToPlaylist(playlistId, projectId);
  // Reordering and removing each go through their own hook: both are undoable, and the toast that
  // confirms them carries the inverse gesture (see `playlist/usePlaylistUndo`).
  const edits = usePlaylistUndo(playlistId, projectId, playlist?.items ?? EMPTY_ITEMS);
  const [editingName, setEditingName] = useState<string | null>(null);
  // Export of the notes for the whole playlist — CSV, sheet, and above all EDL/OTIO, the two
  // formats the editing room can read back. On right click on the header: the page
  // has no dock to house an Export panel, and one more button would add nothing.
  const notesExport = useNotesExportEntry({ scope: 'playlist', id: playlistId });

  const busy = add.isPending || edits.busy;
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
    const previous = playlist?.name;
    setEditingName(null);
    if (!next || previous === undefined || next === previous) return;
    edits.rename(next, previous);
  };

  return (
    <PageShell
      breadcrumb={<EntityBreadcrumb entity="project" id={projectId} tail={playlist?.name ?? ''} />}
      width="fluid"
    >
      <EntityContextMenu entries={[notesExport]}>
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
      </EntityContextMenu>

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
            onReorder={edits.reorder}
            onRemove={edits.remove}
          />
        </div>
      )}
    </PageShell>
  );
}
