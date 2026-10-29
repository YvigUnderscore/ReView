// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, type ReactNode, type RefObject } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  EyeOff,
  Grid3x3,
  Image as ImageIcon,
  LayoutGrid,
  Link2,
  ListVideo,
  PencilLine,
  Play,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '../../components/ui/context-menu';
import { useGuides, type GuideKey } from '../../stores/useGuides';
import { stepVideoFrame, type MediaResp } from './reviewTypes';
import {
  captureVideoFrame,
  copyImageToClipboard,
  downloadImage,
  toThumbnailDataUrl,
  withAnnotations,
} from './mediaCapture';
import type { Shape } from '../../components/AnnotationCanvas';
import { buildContactSheet } from './contactSheet';
import { frameLink } from './deepLink';
import AddToPlaylistDialog from '../../components/AddToPlaylistDialog';
import { NotesExportSubmenu } from '../../components/NotesExportMenu';
import { useAuth } from '../../stores/useAuth';
import { useT } from '../../i18n';

/**
 * Right-click menu of the **image & video** reviews (right-click on the 3D/splat viewers is
 * used for navigation): annotation, copy/download of the image or current frame, video
 * transport, thumbnail. The browser's native menu is disabled across the whole review.
 */
export default function ReviewContextMenu({
  children,
  data,
  videoRef,
  fps,
  canManage,
  annotating,
  onToggleAnnotate,
  hasViewed,
  onClearSelection,
  annShapes = [],
}: {
  children: ReactNode;
  data: MediaResp;
  videoRef: RefObject<HTMLVideoElement | null>;
  fps: number;
  canManage: boolean;
  annotating: boolean;
  onToggleAnnotate: () => void;
  hasViewed: boolean;
  onClearSelection: () => void;
  /** Visible annotations (selected comment or draft) — "annotated" export (No. 93). */
  annShapes?: Shape[];
}) {
  const t = useT();
  const qc = useQueryClient();
  const kind = data.media.kind;
  const isVideo = kind === 'VIDEO';
  // Composition guides (34.G) — local preference, applied to flat viewers.
  const guides = useGuides((s) => s.guides);
  const toggleGuide = useGuides((s) => s.toggle);
  const guideItems: Array<{ key: GuideKey; label: string }> = [
    { key: 'thirds', label: t('review.thirds') },
    { key: 'center', label: t('review.guides.center') },
    { key: 'actionSafe', label: t('review.guides.actionSafe') },
    { key: 'titleSafe', label: t('review.guides.titleSafe') },
  ];
  const baseName = data.media.originalName.replace(/\.[^.]+$/, '');
  // "Add to playlist" from the current review (CP-HUMAIN feedback 33).
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const role = useAuth((s) => s.user?.role);
  const canPlaylist = role !== 'CLIENT';

  // Called from the handlers (never during render — react-hooks/refs rule).
  const run = (label: string, fn: () => Promise<void>) =>
    void fn()
      .then(() => toast.success(label))
      .catch((e: unknown) =>
        toast.error(e instanceof Error ? e.message : t('ctx.actionFailed', { action: label })),
      );

  const frameDataUrl = () => {
    const v = videoRef.current;
    if (!v) throw new Error(t('video.playerUnavailable'));
    return captureVideoFrame(v);
  };

  const setThumbnail = async (src: string) => {
    const { thumbnailUrl } = await api.post<{ thumbnailUrl: string }>(
      `/api/media/${data.media.id}/thumbnail`,
      { dataUrl: await toThumbnailDataUrl(src) },
    );
    qc.setQueryData<MediaResp>(qk.media(data.media.id), (old) => (old ? { ...old, thumbnailUrl } : old));
    void qc.invalidateQueries({ queryKey: qk.version(data.media.versionId) });
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onToggleAnnotate}>
          <PencilLine size={14} /> {annotating ? t('ctx.finishAnnotation') : t('mode.annotate')}
        </ContextMenuItem>
        {hasViewed && (
          <ContextMenuItem onSelect={onClearSelection}>
            <EyeOff size={14} /> {t('ctx.hideAnnotation')}
          </ContextMenuItem>
        )}
        {/* Composition guides (34.G): thirds / cross / safe areas — video and image alike,
            the overlay being mounted in both viewers. */}
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Grid3x3 size={14} /> {t('review.compositionGuides')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {guideItems.map((g) => (
              <ContextMenuItem key={g.key} onClick={() => toggleGuide(g.key)}>
                <Check size={14} className={guides[g.key] ? 'opacity-100' : 'opacity-0'} />
                {g.label}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />

        {isVideo ? (
          <>
            <ContextMenuItem
              onSelect={() => {
                const v = videoRef.current;
                if (!v) return;
                if (v.paused) void v.play();
                else v.pause();
              }}
            >
              <Play size={14} /> {t('shortcuts.playPause')}
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => stepVideoFrame(videoRef.current, fps, -1)}>
              <ChevronLeft size={14} /> {t('review.prevFrame')}
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => stepVideoFrame(videoRef.current, fps, 1)}>
              <ChevronRight size={14} /> {t('video.nextFrame')}
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => run(t('ctx.frameCopied'), async () => copyImageToClipboard(frameDataUrl()))}
            >
              <Copy size={14} /> {t('review.copyFrame')}
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() =>
                run(t('ctx.frameDownloaded'), async () =>
                  downloadImage(frameDataUrl(), `${baseName}-frame.jpg`),
                )
              }
            >
              <Download size={14} /> {t('review.downloadFrame')}
            </ContextMenuItem>
            {annShapes.length > 0 && (
              <ContextMenuItem
                onSelect={() =>
                  run(t('ctx.frameAnnotatedDownloaded'), async () =>
                    downloadImage(
                      await withAnnotations(frameDataUrl(), annShapes),
                      `${baseName}-frame-annotee.jpg`,
                    ),
                  )
                }
              >
                <PencilLine size={14} /> {t('review.downloadAnnotatedFrame')}
              </ContextMenuItem>
            )}
            {/* Contact sheet (34.H): PNG composed from the timeline sprite. */}
            {data.timelineSprite && data.timelineSpriteUrl && (
              <ContextMenuItem
                onSelect={() =>
                  run(t('ctx.contactSheetDownloaded'), async () =>
                    downloadImage(
                      await buildContactSheet(
                        data.timelineSpriteUrl!,
                        data.timelineSprite!,
                        data.media.originalName,
                      ),
                      `${baseName}-planche-contact.png`,
                    ),
                  )
                }
              >
                <LayoutGrid size={14} /> {t('review.contactSheet')}
              </ContextMenuItem>
            )}
            {/* Deep link (32.E): URL opening the review at the current frame. */}
            <ContextMenuItem
              onSelect={() =>
                run(t('comments.linkCopied'), async () => {
                  const v = videoRef.current;
                  if (!v) throw new Error(t('video.playerUnavailable'));
                  const frame = data.startFrame + Math.round(v.currentTime * fps);
                  await navigator.clipboard.writeText(
                    frameLink(window.location.origin, window.location.pathname, frame),
                  );
                })
              }
            >
              <Link2 size={14} /> {t('review.copyFrameLink')}
            </ContextMenuItem>
            {canManage && (
              <ContextMenuItem
                onSelect={() => run(t('task.thumbUpdated'), async () => setThumbnail(frameDataUrl()))}
              >
                <ImageIcon size={14} /> {t('ctx.frameToThumbnail')}
              </ContextMenuItem>
            )}
          </>
        ) : (
          <>
            <ContextMenuItem onSelect={() => run(t('ctx.imageCopied'), () => copyImageToClipboard(data.url))}>
              <Copy size={14} /> {t('ctx.copyImage')}
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() =>
                run(t('ctx.imageDownloaded'), () => downloadImage(data.url, data.media.originalName))
              }
            >
              <Download size={14} /> {t('review.downloadImage')}
            </ContextMenuItem>
            {annShapes.length > 0 && (
              <ContextMenuItem
                onSelect={() =>
                  run(t('ctx.imageAnnotatedDownloaded'), async () =>
                    downloadImage(await withAnnotations(data.url, annShapes), `${baseName}-annotee.jpg`),
                  )
                }
              >
                <PencilLine size={14} /> {t('review.downloadAnnotatedImage')}
              </ContextMenuItem>
            )}
            {canManage && (
              <ContextMenuItem onSelect={() => run(t('task.thumbUpdated'), () => setThumbnail(data.url))}>
                <ImageIcon size={14} /> {t('ctx.imageToThumbnail')}
              </ContextMenuItem>
            )}
          </>
        )}
        {canPlaylist && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => setPlaylistOpen(true)}>
              <ListVideo size={14} /> {t('reviews.addToPlaylist')}
            </ContextMenuItem>
          </>
        )}
        {/* Export of the current media's notes. It used to exist only in a dock tab —
            users look for it here, where they already look for "download the frame". */}
        <ContextMenuSeparator />
        <NotesExportSubmenu scope="media" id={data.media.id} />
      </ContextMenuContent>
      {canPlaylist && (
        <AddToPlaylistDialog
          open={playlistOpen}
          onOpenChange={setPlaylistOpen}
          projectId={data.projectId}
          mediaIds={[data.media.id]}
        />
      )}
    </ContextMenu>
  );
}
