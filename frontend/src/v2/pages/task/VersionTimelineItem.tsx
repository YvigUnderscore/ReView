import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  BellOff,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  ListVideo,
  Trash2,
  Upload,
} from 'lucide-react';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from '../../components/ui/context-menu';
import ReviewDecisionBadge from '../../components/ReviewDecisionBadge';
import ReviewDecisionDialog from '../../components/ReviewDecisionDialog';
import AddToPlaylistDialog from '../../components/AddToPlaylistDialog';
import { timeAgo } from '../../lib/time';
import { useAuth } from '../../stores/useAuth';
import { useWatch } from '../../lib/useWatch';
import MediaTile from './MediaTile';
import { VERSION_STATUS_COLOR, VERSION_STATUS_DOT, VERSION_STATUS_LABEL } from './taskTypes';
import type { MediaSummary, VersionDetail, VersionListItem } from '../../types/api';
import type { ViewMode } from '../../stores/useViewPref';

/** Nœud de la timeline : une version (rail + en-tête + médias dépliables + actions).
 *  Clic droit sur la carte → décision de review (Phase 31, SUPERVISOR+). */
export default function VersionTimelineItem({
  version,
  isLast,
  defaultOpen,
  view,
  canCreate,
  canPublish,
  projectId = null,
  onUpload,
  onPublishVersion,
  onDeleteVersion,
  onPublishMedia,
  onDeleteMedia,
}: {
  version: VersionListItem;
  isLast: boolean;
  defaultOpen: boolean;
  view: ViewMode;
  canCreate: boolean;
  canPublish: boolean;
  /** Projet porteur — active « Ajouter à la playlist » (retours CP-HUMAIN 33). */
  projectId?: number | null;
  onUpload: (versionId: number) => void;
  onPublishVersion: (versionId: number) => void;
  onDeleteVersion: (version: VersionListItem) => void;
  onPublishMedia: (versionId: number, mediaId: number) => void;
  onDeleteMedia: (versionId: number, media: MediaSummary) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const role = useAuth((s) => s.user?.role);
  const canDecide = role === 'ADMIN' || role === 'SUPERVISOR';
  const canPlaylist = projectId !== null && role !== 'CLIENT';
  // Suivi de notifications de la version (32.G).
  const watch = useWatch();
  const watching = watch.isWatching('VERSION', version.id);
  const mediaQ = useQuery({
    queryKey: qk.version(version.id),
    queryFn: () => api.get<{ version: VersionDetail }>(`/api/versions/${version.id}`).then((d) => d.version),
    enabled: open,
  });
  const media = mediaQ.data?.media ?? [];

  return (
    <li className="relative flex gap-3 pb-4">
      <div className="relative flex flex-col items-center pt-1.5">
        <span
          className={`z-10 h-3 w-3 shrink-0 rounded-full ring-2 ring-background ${VERSION_STATUS_DOT[version.status]}`}
        />
        {!isLast && <span className="absolute left-1/2 top-4 h-full w-px -translate-x-1/2 bg-border" />}
      </div>

      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="min-w-0 flex-1 rounded-lg border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <button
                onClick={() => setOpen((o) => !o)}
                className="flex min-w-0 items-center gap-2 text-left"
              >
                {open ? (
                  <ChevronDown size={15} className="shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight size={15} className="shrink-0 text-muted-foreground" />
                )}
                <span className="font-semibold">{version.name}</span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] ${VERSION_STATUS_COLOR[version.status]}`}>
                  {VERSION_STATUS_LABEL[version.status]}
                </span>
                {version.reviewStatus && <ReviewDecisionBadge status={version.reviewStatus} />}
                <span className="truncate text-xs text-muted-foreground">
                  {version.author?.name ? `${version.author.name} · ` : ''}
                  {timeAgo(version.createdAt)} · {version._count.media} média
                  {version._count.media > 1 ? 's' : ''}
                </span>
              </button>
              <div className="flex shrink-0 items-center gap-1.5">
                {canCreate && (
                  <Button size="sm" variant="outline" onClick={() => onUpload(version.id)}>
                    <Upload size={13} /> Média
                  </Button>
                )}
                {canPublish && !version.published && (
                  <Button size="sm" variant="outline" onClick={() => onPublishVersion(version.id)}>
                    Publier
                  </Button>
                )}
                {canCreate && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onDeleteVersion(version)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 size={13} />
                  </Button>
                )}
              </div>
            </div>

            {open && (
              <div className="border-t border-border p-3">
                {mediaQ.isLoading ? (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                    {Array.from({ length: 3 }, (_, i) => (
                      <Skeleton key={i} className="aspect-video w-full" />
                    ))}
                  </div>
                ) : media.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Aucun média dans cette version.
                    {canCreate ? ' Utilisez « Média » ou déposez un fichier ci-dessus.' : ''}
                  </p>
                ) : (
                  <div
                    className={
                      view === 'compact'
                        ? 'space-y-1.5'
                        : 'grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4'
                    }
                  >
                    {media.map((m) => (
                      <MediaTile
                        key={m.id}
                        media={m}
                        versionId={version.id}
                        view={view}
                        canManage={canCreate}
                        onPublish={(mm) => onPublishMedia(version.id, mm.id)}
                        onDelete={(mm) => onDeleteMedia(version.id, mm)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => setDecisionOpen(true)}>
            <ClipboardCheck size={14} />
            {canDecide ? 'Décision de review…' : 'Historique des décisions…'}
          </ContextMenuItem>
          {/* Suivi (32.G) : notifications sur commentaires/publications/décisions. */}
          <ContextMenuItem onClick={() => watch.toggle('VERSION', version.id)}>
            {watching ? <BellOff size={14} /> : <Bell size={14} />}
            {watching ? 'Ne plus suivre cette version' : 'Suivre cette version'}
          </ContextMenuItem>
          {canPlaylist && (
            <ContextMenuItem onClick={() => setPlaylistOpen(true)}>
              <ListVideo size={14} /> Ajouter à la playlist…
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>

      {canPlaylist && (
        <AddToPlaylistDialog
          open={playlistOpen}
          onOpenChange={setPlaylistOpen}
          projectId={projectId}
          versionIds={[version.id]}
        />
      )}

      <ReviewDecisionDialog
        versionId={version.id}
        versionName={version.name}
        open={decisionOpen}
        onOpenChange={setDecisionOpen}
        canDecide={canDecide}
      />
    </li>
  );
}
