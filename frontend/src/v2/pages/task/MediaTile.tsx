// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Play, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { fileToThumbnailDataUrl } from '../review/mediaCapture';
import { reviewPath } from '../../lib/slug';
import { MEDIA_KIND_ICON } from './taskTypes';
import type { MediaSummary } from '../../types/api';
import type { ViewMode } from '../../stores/useViewPref';
import { useT } from '../../i18n';

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

/** Bouton discret « Modifier la miniature » : fichier image → réduit → POST /thumbnail. */
function ThumbEditButton({
  mediaId,
  versionId,
  small,
}: {
  mediaId: number;
  versionId: number;
  small?: boolean;
}) {
  const t = useT();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const pick = async (file: File) => {
    try {
      await api.post(`/api/media/${mediaId}/thumbnail`, { dataUrl: await fileToThumbnailDataUrl(file) });
      await qc.invalidateQueries({ queryKey: qk.version(versionId) });
      toast.success(t('task.thumbUpdated'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('media.thumbFailed'));
    }
  };
  return (
    <>
      <button
        onClick={() => fileRef.current?.click()}
        title={t('task.editThumb')}
        className={
          small
            ? 'rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground'
            : 'flex items-center justify-center px-2 py-1 text-muted-foreground hover:bg-secondary hover:text-foreground'
        }
      >
        <ImagePlus size={12} />
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void pick(f);
          if (fileRef.current) fileRef.current.value = '';
        }}
      />
    </>
  );
}

/** Vignette d'un média → review au clic ; actions publier/supprimer/miniature. Cartes ou ligne compacte. */
export default function MediaTile({
  media,
  versionId,
  view,
  canManage,
  onPublish,
  onDelete,
}: {
  media: MediaSummary;
  versionId: number;
  view: ViewMode;
  canManage: boolean;
  onPublish: (m: MediaSummary) => void;
  onDelete: (m: MediaSummary) => void;
}) {
  const t = useT();
  if (view === 'compact') {
    return (
      <div className="group flex items-center gap-2 rounded-md border border-border bg-card p-1.5">
        <Link to={reviewPath(media)} className="flex min-w-0 flex-1 items-center gap-2">
          <div className="relative flex aspect-video h-9 shrink-0 items-center justify-center overflow-hidden rounded bg-black/40 text-muted-foreground">
            <MediaThumb media={media} size={14} />
          </div>
          <div className="min-w-0">
            <div className="truncate text-xs text-foreground">{media.originalName}</div>
            <div className="truncate text-[10px] text-muted-foreground">
              {media.kind} · {media.status}
              {!media.published && <span className="ml-1 text-primary">· {t('media.draft')}</span>}
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
                {t('common.publish')}
              </button>
            )}
            <ThumbEditButton mediaId={media.id} versionId={versionId} small />
            <button
              onClick={() => onDelete(media)}
              title={t('common.delete')}
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
      <Link
        to={reviewPath(media)}
        title={t('review.openNamed', { name: media.originalName })}
        className="block"
      >
        <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-black/40 text-muted-foreground">
          <MediaThumb media={media} size={22} />
          {!media.published && (
            <span className="absolute left-1 top-1 rounded bg-primary/20 px-1 text-[10px] text-primary">
              {t('reviews.draft')}
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
              {t('common.publish')}
            </button>
          )}
          <ThumbEditButton mediaId={media.id} versionId={versionId} />
          <button
            onClick={() => onDelete(media)}
            title={t('common.delete')}
            className="flex items-center justify-center px-2 py-1 text-muted-foreground hover:bg-secondary hover:text-destructive"
          >
            <Trash2 size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
