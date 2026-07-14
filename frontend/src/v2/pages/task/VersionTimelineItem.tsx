import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Play, Trash2, Upload } from 'lucide-react';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import { timeAgo } from '../../lib/time';
import { MEDIA_KIND_ICON, VERSION_STATUS_COLOR, VERSION_STATUS_DOT, VERSION_STATUS_LABEL } from './taskTypes';
import type { MediaSummary, VersionDetail, VersionListItem } from '../../types/api';
import type { ViewMode } from '../../stores/useViewPref';

/** Miniature d'un média (vraie vignette ou icône selon le type). */
function MediaThumb({ media, size }: { media: MediaSummary; size: number }) {
  const Icon = MEDIA_KIND_ICON[media.kind];
  return media.thumbnailUrl ? (
    <img
      src={media.thumbnailUrl}
      alt={media.originalName}
      loading="lazy"
      className="h-full w-full object-cover"
    />
  ) : (
    <Icon size={size} />
  );
}

/** Vignette d'un média → review au clic ; actions publier/supprimer. Cartes ou ligne compacte. */
function MediaTile({
  media,
  view,
  canManage,
  onPublish,
  onDelete,
}: {
  media: MediaSummary;
  view: ViewMode;
  canManage: boolean;
  onPublish: (m: MediaSummary) => void;
  onDelete: (m: MediaSummary) => void;
}) {
  if (view === 'compact') {
    return (
      <div className="group flex items-center gap-2 rounded-md border border-border bg-card p-1.5">
        <Link to={`/review/${media.id}`} className="flex min-w-0 flex-1 items-center gap-2">
          <div className="relative flex aspect-video h-9 shrink-0 items-center justify-center overflow-hidden rounded bg-black/40 text-muted-foreground">
            <MediaThumb media={media} size={14} />
          </div>
          <div className="min-w-0">
            <div className="truncate text-xs text-foreground">{media.originalName}</div>
            <div className="truncate text-[10px] text-muted-foreground">
              {media.kind} · {media.status}
              {!media.published && <span className="ml-1 text-primary">· Brouillon</span>}
            </div>
          </div>
        </Link>
        {canManage && (
          <div className="flex shrink-0 items-center gap-1 text-[10px]">
            {!media.published && (
              <button
                onClick={() => onPublish(media)}
                className="rounded px-1.5 py-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                Publier
              </button>
            )}
            <button
              onClick={() => onDelete(media)}
              title="Supprimer"
              className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-destructive"
            >
              <Trash2 size={12} />
            </button>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="group overflow-hidden rounded-md border border-border bg-card">
      <Link to={`/review/${media.id}`} title={`Ouvrir la review : ${media.originalName}`} className="block">
        <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-black/40 text-muted-foreground">
          <MediaThumb media={media} size={22} />
          {!media.published && (
            <span className="absolute left-1 top-1 rounded bg-primary/20 px-1 text-[10px] text-primary">
              Brouillon
            </span>
          )}
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
            <Play size={18} className="text-primary" />
          </div>
        </div>
        <div className="truncate px-1.5 pt-1 text-[11px] text-foreground">{media.originalName}</div>
        <div className="truncate px-1.5 pb-1 text-[10px] text-muted-foreground">
          {media.kind} · {media.status}
        </div>
      </Link>
      {canManage && (
        <div className="flex border-t border-border text-[10px]">
          {!media.published && (
            <button
              onClick={() => onPublish(media)}
              className="flex-1 py-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              Publier
            </button>
          )}
          <button
            onClick={() => onDelete(media)}
            title="Supprimer"
            className="flex items-center justify-center px-2 py-1 text-muted-foreground hover:bg-secondary hover:text-destructive"
          >
            <Trash2 size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

/** Nœud de la timeline : une version (rail + en-tête + médias dépliables + actions). */
export default function VersionTimelineItem({
  version,
  isLast,
  defaultOpen,
  view,
  canCreate,
  canPublish,
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
  onUpload: (versionId: number) => void;
  onPublishVersion: (versionId: number) => void;
  onDeleteVersion: (version: VersionListItem) => void;
  onPublishMedia: (versionId: number, mediaId: number) => void;
  onDeleteMedia: (versionId: number, media: MediaSummary) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
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

      <div className="min-w-0 flex-1 rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <button onClick={() => setOpen((o) => !o)} className="flex min-w-0 items-center gap-2 text-left">
            {open ? (
              <ChevronDown size={15} className="shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight size={15} className="shrink-0 text-muted-foreground" />
            )}
            <span className="font-semibold">{version.name}</span>
            <span className={`rounded px-1.5 py-0.5 text-[10px] ${VERSION_STATUS_COLOR[version.status]}`}>
              {VERSION_STATUS_LABEL[version.status]}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {version.author?.name ? `${version.author.name} · ` : ''}
              {timeAgo(version.createdAt)} · {version._count.media} média{version._count.media > 1 ? 's' : ''}
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
                  view === 'compact' ? 'space-y-1.5' : 'grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4'
                }
              >
                {media.map((m) => (
                  <MediaTile
                    key={m.id}
                    media={m}
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
    </li>
  );
}
