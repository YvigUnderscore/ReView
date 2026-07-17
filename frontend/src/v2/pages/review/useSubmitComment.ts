import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { RefObject } from 'react';
import { api } from '../../../lib/apiClient';
import { uploadCommentAttachments } from '../../../lib/commentAttachments';
import { qk } from '../../lib/query';
import type { ReviewComment } from '../../types/api';
import type { MediaResp } from './reviewTypes';
import type { Annotations } from './useAnnotations';
import type { SplatPaintState } from './splat/paint/useSplatPaint';

/**
 * Envoi d'un commentaire de review (extrait de ReviewPage, budget 10.F4) : assemble
 * timestamp/caméra/annotation (hotspot + painter + anim caméra + dessins 2D), téléverse
 * les pièces jointes, crée le commentaire puis lie les **images de référence en
 * préparation** (position figée côté serveur). Renvoie true si l'envoi a réussi.
 */
export function useSubmitComment(opts: {
  id: number;
  data: MediaResp | null;
  ann: Annotations;
  paint: SplatPaintState;
  videoRef: RefObject<HTMLVideoElement | null>;
  captureCamera: () => unknown;
  loadComments: () => Promise<unknown>;
}) {
  const qc = useQueryClient();
  const { id, data, ann, paint, videoRef, captureCamera, loadComments } = opts;

  return async (text: string, files: File[]): Promise<boolean> => {
    const kind = data?.media.kind;
    const timestamp = kind === 'VIDEO' && videoRef.current ? videoRef.current.currentTime : undefined;
    const cameraState = kind === 'MODEL_3D' || kind === 'SPLAT' ? captureCamera() : undefined;
    // Annotation : 3D/splat = hotspot de surface + dessins 2D ; autres = dessins 2D.
    let annotation: unknown;
    if (kind === 'MODEL_3D' || kind === 'SPLAT') {
      const parts: unknown[] = [];
      if (ann.hotspot3d)
        parts.push({
          type: 'hotspot',
          position: ann.hotspot3d.position,
          normal: ann.hotspot3d.normal,
          space: ann.hotspot3d.space, // espace-objet (splat, V10) — suit la transformation
        });
      if (kind === 'SPLAT') parts.push(...paint.serializePending()); // traits du painter (V9)
      // Mode layout : anim caméra (F-curves v2) jointe au commentaire (au lieu de dessiner).
      if (ann.cameraAnim)
        parts.push({
          type: 'camera-anim',
          version: ann.cameraAnim.version,
          loop: ann.cameraAnim.loop,
          channels: ann.cameraAnim.channels,
        });
      parts.push(...ann.annot);
      annotation = parts.length ? parts : undefined;
    } else {
      annotation = ann.annot.length ? ann.annot : undefined;
    }
    try {
      const attachments = files.length > 0 ? await uploadCommentAttachments(files) : undefined;
      const { comment } = await api.post<{ comment: ReviewComment }>('/api/comments', {
        mediaObjectId: id,
        // Texte optionnel (annotation seule) : placeholder minimal pour la contrainte backend.
        content: text.trim() || (annotation ? '(annotation)' : '(image)'),
        timestamp,
        cameraState,
        annotation,
        attachments,
      });
      await linkStagedReferences(qc, id, ann, comment.id);
      ann.resetComposer();
      paint.clearPending();
      await loadComments();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur à l'envoi du commentaire");
      return false;
    }
  };
}

/** Images de référence en préparation → liées au commentaire créé, position figée. */
async function linkStagedReferences(qc: QueryClient, id: number, ann: Annotations, commentId: number) {
  for (const r of ann.stagedRefs) {
    try {
      const { reference } = await api.post<{ reference: MediaResp['references'][number] }>(
        `/api/media/${id}/references`,
        { dataUrl: r.dataUrl, commentId, x: r.x, y: r.y, width: r.width },
      );
      qc.setQueryData<MediaResp>(qk.media(id), (old) =>
        old ? { ...old, references: [...(old.references ?? []), reference] } : old,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Une image de référence n'a pas pu être envoyée");
    }
  }
}
