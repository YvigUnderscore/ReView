// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ListVideo, Pencil, Play, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { useAuth } from '../../stores/useAuth';
import { useLiveSessionsQuery } from '../../lib/queries';
import type { PlaylistDetail, PlaylistSummary } from '../../types/api';
import ConfirmDialog from '../../components/ConfirmDialog';
import { itemPath } from '../review/playlistNav';
import PlaylistCard from './PlaylistCard';
import EmptyState from '../../components/ui/empty-state';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Skeleton } from '../../components/ui/skeleton';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { useT } from '../../i18n';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '../../components/ui/context-menu';

/**
 * Onglet Playlists du projet (Phase 33) : dailies = versions ordonnées cross-shots.
 *
 * Chaque playlist mène à sa page (C5), où l'on construit son contenu depuis le catalogue
 * du projet. L'accordéon d'ici ne montrait que ce qu'elle contient déjà — on n'y ajoutait
 * rien, il fallait ouvrir chaque plan un par un pour y cliquer « ajouter ».
 */
export default function PlaylistsTab({ projectId }: { projectId: number }) {
  const t = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const role = useAuth((s) => s.user?.role);
  const userId = useAuth((s) => s.user?.id);
  const canWrite = role === 'ADMIN' || role === 'SUPERVISOR' || role === 'ARTIST';
  const isManager = role === 'ADMIN' || role === 'SUPERVISOR';

  const [renaming, setRenaming] = useState<PlaylistSummary | null>(null);
  const [creating, setCreating] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [deleting, setDeleting] = useState<PlaylistSummary | null>(null);

  const listQ = useQuery({
    queryKey: qk.playlists(projectId),
    queryFn: () =>
      api
        .get<{ playlists: PlaylistSummary[] }>(`/api/playlists?projectId=${projectId}`)
        .then((d) => d.playlists),
  });
  const playlists = listQ.data ?? [];

  const refresh = () => void qc.invalidateQueries({ queryKey: ['playlists', projectId] });
  const canEdit = (p: PlaylistSummary) => canWrite && (isManager || p.createdBy?.id === userId);
  // Sessions live en cours → badge LIVE cliquable sur la playlist (retours 33).
  const liveQ = useLiveSessionsQuery(projectId);
  const liveOf = (playlistId: number) => (liveQ.data ?? []).find((s) => s.playlistId === playlistId) ?? null;

  const playFirst = async (p: PlaylistSummary, joinLive = false) => {
    try {
      const { playlist } = await api.get<{ playlist: PlaylistDetail }>(`/api/playlists/${p.id}`);
      const first = playlist.items.find((it) => it.media);
      const path = first ? itemPath(first, p.id) : null;
      if (!path) return toast.error(t('playlists.unreadable'));
      void navigate(joinLive ? `${path}&live=1` : path);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('playlists.inaccessible'));
    }
  };

  const submitName = async () => {
    const name = nameDraft.trim();
    if (!name) return;
    try {
      if (renaming) {
        await api.patch(`/api/playlists/${renaming.id}`, { name });
        toast.success(t('playlists.renamed'));
      } else {
        await api.post('/api/playlists', { projectId, name });
        toast.success(t('playlists.created'));
      }
      setRenaming(null);
      setCreating(false);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error.generic'));
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await api.del(`/api/playlists/${deleting.id}`);
      toast.success(t('playlists.deleted'));
      setDeleting(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error.generic'));
    }
  };

  if (listQ.isLoading)
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );

  return (
    <div className="space-y-2">
      {playlists.length === 0 ? (
        <EmptyState
          icon={ListVideo}
          title={t('playlists.empty.title')}
          description={t('playlists.empty.hint')}
          action={canWrite ? t('playlists.new') : undefined}
          onAction={canWrite ? () => (setCreating(true), setNameDraft('')) : undefined}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {playlists.map((p) => (
              <ContextMenu key={p.id}>
                <ContextMenuTrigger asChild>
                  <div>
                    <PlaylistCard
                      playlist={p}
                      live={liveOf(p.id)}
                      onPlay={(joinLive) => void playFirst(p, joinLive)}
                    />
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onClick={() => void navigate(`/playlists/${p.id}`)}>
                    <ListVideo size={14} /> {t('common.open')}
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => void playFirst(p)}>
                    <Play size={14} /> {t('playlist.play')}
                  </ContextMenuItem>
                  {canEdit(p) && (
                    <>
                      <ContextMenuItem onClick={() => (setRenaming(p), setNameDraft(p.name))}>
                        <Pencil size={14} /> {t('common.renameEllipsis')}
                      </ContextMenuItem>
                      <ContextMenuItem danger onClick={() => setDeleting(p)}>
                        <Trash2 size={14} /> {t('common.deleteEllipsis')}
                      </ContextMenuItem>
                    </>
                  )}
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </div>
          {canWrite && (
            <Button size="sm" variant="ghost" onClick={() => (setCreating(true), setNameDraft(''))}>
              {t('playlists.new')}
            </Button>
          )}
        </>
      )}

      <Dialog
        open={creating || renaming !== null}
        onOpenChange={(o) => !o && (setCreating(false), setRenaming(null))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{renaming ? t('playlists.rename') : t('playlists.new')}</DialogTitle>
          </DialogHeader>
          <Input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submitName()}
            placeholder={t('playlists.name.placeholder')}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => (setCreating(false), setRenaming(null))}>
              {t('common.undo')}
            </Button>
            <Button onClick={() => void submitName()} disabled={!nameDraft.trim()}>
              {renaming ? t('common.rename') : t('common.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        title={t('playlists.delete.title')}
        message={t('playlists.delete.message', { name: deleting?.name ?? '' })}
        confirmLabel={t('common.delete')}
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
