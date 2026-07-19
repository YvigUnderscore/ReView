import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, ListVideo, Pencil, Play, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { timeAgo } from '../../lib/time';
import { useAuth } from '../../stores/useAuth';
import type { PlaylistDetail, PlaylistSummary } from '../../types/api';
import ConfirmDialog from '../../components/ConfirmDialog';
import PlaylistItems from './PlaylistItems';
import { itemPath } from '../review/playlistNav';
import EmptyState from '../../components/ui/empty-state';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Skeleton } from '../../components/ui/skeleton';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
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

  const playFirst = async (p: PlaylistSummary) => {
    try {
      const { playlist } = await api.get<{ playlist: PlaylistDetail }>(`/api/playlists/${p.id}`);
      const first = playlist.items.find((it) => it.media);
      const path = first ? itemPath(first, p.id) : null;
      if (!path) return toast.error('Aucun média lisible dans cette playlist');
      navigate(path);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Playlist inaccessible');
    }
  };

  const submitName = async () => {
    const name = nameDraft.trim();
    if (!name) return;
    try {
      if (renaming) {
        await api.patch(`/api/playlists/${renaming.id}`, { name });
        toast.success('Playlist renommée');
      } else {
        await api.post('/api/playlists', { projectId, name });
        toast.success('Playlist créée');
      }
      setRenaming(null);
      setCreating(false);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erreur');
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await api.del(`/api/playlists/${deleting.id}`);
      toast.success('Playlist supprimée');
      setDeleting(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erreur');
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
          title="Aucune playlist"
          description="Sélectionnez des médias sur la page Reviews puis « Ajouter à la playlist » (clic droit), ou créez une playlist vide ici."
          action={canWrite ? 'Nouvelle playlist' : undefined}
          onAction={canWrite ? () => (setCreating(true), setNameDraft('')) : undefined}
        />
      ) : (
        <>
          {playlists.map((p) => (
            <ContextMenu key={p.id}>
              <ContextMenuTrigger asChild>
                <div className="rounded-lg border border-border bg-card">
                  <button
                    onClick={() => setOpenId((o) => (o === p.id ? null : p.id))}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
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
                  {openId === p.id && (
                    <PlaylistItems playlistId={p.id} canEdit={canEdit(p)} onChanged={refresh} />
                  )}
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onClick={() => void playFirst(p)}>
                  <Play size={14} /> Lire la playlist
                </ContextMenuItem>
                {canEdit(p) && (
                  <>
                    <ContextMenuItem onClick={() => (setRenaming(p), setNameDraft(p.name))}>
                      <Pencil size={14} /> Renommer…
                    </ContextMenuItem>
                    <ContextMenuItem danger onClick={() => setDeleting(p)}>
                      <Trash2 size={14} /> Supprimer…
                    </ContextMenuItem>
                  </>
                )}
              </ContextMenuContent>
            </ContextMenu>
          ))}
          {canWrite && (
            <Button size="sm" variant="ghost" onClick={() => (setCreating(true), setNameDraft(''))}>
              Nouvelle playlist
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
            <DialogTitle>{renaming ? 'Renommer la playlist' : 'Nouvelle playlist'}</DialogTitle>
          </DialogHeader>
          <Input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submitName()}
            placeholder="Nom de la playlist (ex. Dailies lundi)"
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => (setCreating(false), setRenaming(null))}>
              Annuler
            </Button>
            <Button onClick={() => void submitName()} disabled={!nameDraft.trim()}>
              {renaming ? 'Renommer' : 'Créer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        title="Supprimer la playlist ?"
        message={
          <>« {deleting?.name} » sera supprimée. Les versions qu’elle référence ne sont pas affectées.</>
        }
        confirmLabel="Supprimer"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
