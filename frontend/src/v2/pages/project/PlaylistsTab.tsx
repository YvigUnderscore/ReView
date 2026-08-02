// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, ListVideo, Pencil, Play, Radio, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { timeAgo } from '../../lib/time';
import { useAuth } from '../../stores/useAuth';
import { useLiveSessionsQuery } from '../../lib/queries';
import type { PlaylistDetail, PlaylistSummary } from '../../types/api';
import ConfirmDialog from '../../components/ConfirmDialog';
import PlaylistItems from './PlaylistItems';
import { itemPath } from '../review/playlistNav';
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
 * Gestion par clic droit (lire, renommer, supprimer ; item : monter/descendre/retirer),
 * lecture enchaînée via `?playlist=` sur la review.
 */
export default function PlaylistsTab({ projectId }: { projectId: number }) {
  const t = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const role = useAuth((s) => s.user?.role);
  const userId = useAuth((s) => s.user?.id);
  const canWrite = role === 'ADMIN' || role === 'SUPERVISOR' || role === 'ARTIST';
  const isManager = role === 'ADMIN' || role === 'SUPERVISOR';

  const [openId, setOpenId] = useState<number | null>(null);
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

  const refresh = () => qc.invalidateQueries({ queryKey: ['playlists', projectId] });
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
      navigate(joinLive ? `${path}&live=1` : path);
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
          {playlists.map((p) => (
            <ContextMenu key={p.id}>
              <ContextMenuTrigger asChild>
                <div className="rounded-lg border border-border bg-card">
                  <div className="flex items-center">
                    <button
                      onClick={() => setOpenId((o) => (o === p.id ? null : p.id))}
                      className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left"
                    >
                      {openId === p.id ? (
                        <ChevronDown size={15} className="shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight size={15} className="shrink-0 text-muted-foreground" />
                      )}
                      <ListVideo size={15} className="shrink-0 text-muted-foreground" />
                      <span className="font-medium">{p.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {p._count.items} version{p._count.items > 1 ? 's' : ''}
                        {p.createdBy?.name ? ` · ${p.createdBy.name}` : ''} · {timeAgo(p.updatedAt)}
                      </span>
                    </button>
                    {liveOf(p.id) && (
                      <button
                        onClick={() => void playFirst(p, true)}
                        title={`Review live en cours (${liveOf(p.id)!.participantCount} participant${liveOf(p.id)!.participantCount > 1 ? 's' : ''}). Cliquer pour rejoindre.`}
                        className="mr-3 flex shrink-0 items-center gap-1 rounded-md border border-accent2/60 bg-accent2/10 px-1.5 py-0.5 text-[11px] font-semibold text-accent2 hover:bg-accent2/20"
                      >
                        <Radio size={12} className="animate-pulse" /> LIVE · {liveOf(p.id)!.participantCount}
                      </button>
                    )}
                  </div>
                  {openId === p.id && (
                    <PlaylistItems playlistId={p.id} canEdit={canEdit(p)} onChanged={refresh} />
                  )}
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onClick={() => void playFirst(p)}>
                  <Play size={14} /> {t('playlist.play')}
                </ContextMenuItem>
                {canEdit(p) && (
                  <>
                    <ContextMenuItem onClick={() => (setRenaming(p), setNameDraft(p.name))}>
                      <Pencil size={14} /> Renommer…
                    </ContextMenuItem>
                    <ContextMenuItem danger onClick={() => setDeleting(p)}>
                      <Trash2 size={14} /> {t('common.deleteEllipsis')}
                    </ContextMenuItem>
                  </>
                )}
              </ContextMenuContent>
            </ContextMenu>
          ))}
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
        message={
          <>« {deleting?.name} » sera supprimée. Les versions qu’elle référence ne sont pas affectées.</>
        }
        confirmLabel={t('common.delete')}
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
