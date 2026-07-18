import { type ReactNode, type RefObject } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  EyeOff,
  Image as ImageIcon,
  Link2,
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
  ContextMenuTrigger,
} from '../../components/ui/context-menu';
import { stepVideoFrame, type MediaResp } from './reviewTypes';
import { captureVideoFrame, copyImageToClipboard, downloadImage, toThumbnailDataUrl } from './mediaCapture';
import { frameLink } from './deepLink';

/**
 * Menu clic droit des reviews **image & vidéo** (le clic droit des viewers 3D/splat sert
 * à la navigation) : annotation, copie/téléchargement de l'image ou de la frame courante,
 * transport vidéo, miniature. Le menu natif du navigateur est désactivé sur toute la review.
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
}) {
  const qc = useQueryClient();
  const kind = data.media.kind;
  const isVideo = kind === 'VIDEO';
  const baseName = data.media.originalName.replace(/\.[^.]+$/, '');

  // Appelé depuis les handlers (jamais pendant le render — règle react-hooks/refs).
  const run = (label: string, fn: () => Promise<void>) =>
    void fn()
      .then(() => toast.success(label))
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : `${label} : échec`));

  const frameDataUrl = () => {
    const v = videoRef.current;
    if (!v) throw new Error('Lecteur vidéo indisponible');
    return captureVideoFrame(v);
  };

  const setThumbnail = async (src: string) => {
    const { thumbnailUrl } = await api.post<{ thumbnailUrl: string }>(
      `/api/media/${data.media.id}/thumbnail`,
      { dataUrl: await toThumbnailDataUrl(src) },
    );
    qc.setQueryData<MediaResp>(qk.media(data.media.id), (old) => (old ? { ...old, thumbnailUrl } : old));
    qc.invalidateQueries({ queryKey: qk.version(data.media.versionId) });
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onToggleAnnotate}>
          <PencilLine size={14} /> {annotating ? "Terminer l'annotation" : 'Annoter'}
        </ContextMenuItem>
        {hasViewed && (
          <ContextMenuItem onSelect={onClearSelection}>
            <EyeOff size={14} /> Masquer l’annotation
          </ContextMenuItem>
        )}
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
              <Play size={14} /> Lecture / pause
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => stepVideoFrame(videoRef.current, fps, -1)}>
              <ChevronLeft size={14} /> Frame précédente
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => stepVideoFrame(videoRef.current, fps, 1)}>
              <ChevronRight size={14} /> Frame suivante
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              onSelect={() => run('Frame copiée', async () => copyImageToClipboard(frameDataUrl()))}
            >
              <Copy size={14} /> Copier la frame
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() =>
                run('Frame téléchargée', async () => downloadImage(frameDataUrl(), `${baseName}-frame.jpg`))
              }
            >
              <Download size={14} /> Télécharger la frame
            </ContextMenuItem>
            {/* Lien profond (32.E) : URL ouvrant la review à la frame courante. */}
            <ContextMenuItem
              onSelect={() =>
                run('Lien copié', async () => {
                  const v = videoRef.current;
                  if (!v) throw new Error('Lecteur vidéo indisponible');
                  const frame = data.startFrame + Math.round(v.currentTime * fps);
                  await navigator.clipboard.writeText(
                    frameLink(window.location.origin, window.location.pathname, frame),
                  );
                })
              }
            >
              <Link2 size={14} /> Copier le lien à cette frame
            </ContextMenuItem>
            {canManage && (
              <ContextMenuItem
                onSelect={() => run('Miniature mise à jour', async () => setThumbnail(frameDataUrl()))}
              >
                <ImageIcon size={14} /> Frame courante → miniature
              </ContextMenuItem>
            )}
          </>
        ) : (
          <>
            <ContextMenuItem onSelect={() => run('Image copiée', () => copyImageToClipboard(data.url))}>
              <Copy size={14} /> Copier l’image
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() =>
                run('Image téléchargée', () => downloadImage(data.url, data.media.originalName))
              }
            >
              <Download size={14} /> Télécharger l’image
            </ContextMenuItem>
            {canManage && (
              <ContextMenuItem onSelect={() => run('Miniature mise à jour', () => setThumbnail(data.url))}>
                <ImageIcon size={14} /> Image → miniature
              </ContextMenuItem>
            )}
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
