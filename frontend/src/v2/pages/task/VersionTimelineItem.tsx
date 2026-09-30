// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  BellOff,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  ListVideo,
  Radio,
  Trash2,
  Upload,
} from 'lucide-react';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { reviewPath } from '../../lib/slug';
import { useLiveSessionsQuery } from '../../lib/queries';
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
import { useFileDrop } from '../../lib/useFileDrop';
import MediaTile from './MediaTile';
import { VERSION_STATUS_COLOR, VERSION_STATUS_DOT, versionStatusLabels } from './taskTypes';
import type { MediaSummary, VersionDetail, VersionListItem } from '../../types/api';
import type { ViewMode } from '../../stores/useViewPref';
import { useT } from '../../i18n';

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
  onDropFiles,
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
  /** Fichiers lâchés sur la carte : ils rejoignent cette version (Phase 46). */
  onDropFiles: (versionId: number, files: File[]) => void;
  onPublishVersion: (versionId: number) => void;
  onDeleteVersion: (version: VersionListItem) => void;
  onPublishMedia: (versionId: number, mediaId: number) => void;
  onDeleteMedia: (versionId: number, media: MediaSummary) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(defaultOpen);
  const { over, dropProps } = useFileDrop((files) => onDropFiles(version.id, files));
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const navigate = useNavigate();
  const role = useAuth((s) => s.user?.role);
  // Session live en cours sur un média de cette version → badge LIVE cliquable (retours 33).
  const liveQ = useLiveSessionsQuery(projectId);
  const liveSession = (liveQ.data ?? []).find((s) => s.versionId === version.id && s.mediaId != null) ?? null;
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
          {/* La carte est elle-même une cible de dépôt : lâcher un fichier dessus le verse
              dans CETTE version, là où la zone du haut en crée une nouvelle (Phase 46). */}
          <div
            {...(canCreate ? dropProps : {})}
            className={`min-w-0 flex-1 rounded-lg border bg-card transition-colors ${
              over ? 'border-primary ring-1 ring-primary/40' : 'border-border'
            }`}
          >
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
                <span className={`rounded px-1.5 py-0.5 text-2xs ${VERSION_STATUS_COLOR[version.status]}`}>
                  {versionStatusLabels(t)[version.status]}
                </span>
                {version.reviewStatus && <ReviewDecisionBadge status={version.reviewStatus} />}
                <span className="truncate text-xs text-muted-foreground">
                  {version.author?.name ? `${version.author.name} · ` : ''}
                  {timeAgo(version.createdAt)} · {t('reviews.count', { count: version._count.media })}
                </span>
              </button>
              <div className="flex shrink-0 items-center gap-1.5">
                {liveSession && (
                  <button
                    onClick={() => navigate(`${reviewPath({ id: liveSession.mediaId! })}?live=1`)}
                    title={
                      (liveSession.pilot
                        ? t('live.runningWithPilot', { pilot: liveSession.pilot.displayName })
                        : t('live.running')) +
                      ` ${t('live.participants', { count: liveSession.participantCount })} ${t(
                        'live.clickToJoin',
                      )}`
                    }
                    className="flex items-center gap-1 rounded-md border border-accent2/60 bg-accent2/10 px-1.5 py-0.5 text-xs font-semibold text-accent2 hover:bg-accent2/20"
                  >
                    <Radio size={12} className="animate-pulse" /> {t('live.badge')} ·{' '}
                    {liveSession.participantCount}
                  </button>
                )}
                {canCreate && (
                  <Button size="sm" variant="outline" onClick={() => onUpload(version.id)}>
                    <Upload size={13} /> {t('review.export.media')}
                  </Button>
                )}
                {/* Publication en un geste (Phase 46) : proposée dès qu'il reste un
                    brouillon à soi, ou à un superviseur sur une version encore privée. */}
                {!version.published && (version.draftCount > 0 || canPublish) && (
                  <Button size="sm" variant="outline" onClick={() => onPublishVersion(version.id)}>
                    {version.draftCount > 0
                      ? t('version.publishAll', { count: version.draftCount })
                      : t('common.publish')}
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
                    {t('version.emptyMedia')}
                    {canCreate ? ` ${t('version.useMediaOrDrop')}` : ''}
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
            {canDecide ? t('version.decisionEllipsis') : t('version.historyEllipsis')}
          </ContextMenuItem>
          {/* Suivi (32.G) : notifications sur commentaires/publications/décisions. */}
          <ContextMenuItem onClick={() => watch.toggle('VERSION', version.id)}>
            {watching ? <BellOff size={14} /> : <Bell size={14} />}
            {watching ? t('watch.unfollowVersion') : t('watch.followVersion')}
          </ContextMenuItem>
          {canPlaylist && (
            <ContextMenuItem onClick={() => setPlaylistOpen(true)}>
              <ListVideo size={14} /> {t('reviews.addToPlaylist')}
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
        projectId={projectId ?? undefined}
      />
    </li>
  );
}
