// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { RefObject } from 'react';
import { api } from '@/lib/apiClient';
import { uploadCommentAttachments } from '../../lib/commentAttachments';
import { qk } from '../../lib/query';
import type { ReviewComment } from '../../types/api';
import type { MediaResp } from './reviewTypes';
import type { Annotations } from './useAnnotations';
import type { SplatPaintState } from './splat/paint/useSplatPaint';
import { buildPoiPart, poiContent } from './poi/poiPoints';
import { buildSplatEditPart } from './splat/splatEditPart';
import { uploadSplatEditBlobs } from './splat/splatEditUpload';
import { poiStoredPoints, poiUploadPlan } from './poi/poiUpload';
import { useT, t as translate } from '../../i18n';

/**
 * Sends a review comment (extracted from ReviewPage, budget 10.F4): assembles timestamp/camera/annotation
 * (points of interest + painter + camera animation + 2D drawings), uploads the attachments, creates the
 * comment, then links the **reference images in preparation** (position frozen server-side). Returns
 * true if the send succeeded.
 *
 * **A single comment is sent**, whatever the number of points of interest placed: it carries all the
 * points (`poi` part), each one's remark copied numbered into its text, and their images in the
 * comment's attachments list. This is the form settled with the user, and it is what leaves the client
 * portal, the notes export and the ShotGrid bridge unchanged — they only read `content`.
 */
export function useSubmitComment(opts: {
  id: number;
  data: MediaResp | null;
  ann: Annotations;
  paint: SplatPaintState;
  videoRef: RefObject<HTMLVideoElement | null>;
  captureCamera: () => unknown;
  loadComments: () => Promise<unknown>;
  /** Active I/O loop (seconds): attached as the comment's in→out range (34.A). */
  loop?: { in: number | null; out: number | null };
  fps?: number;
}) {
  const t = useT();
  const qc = useQueryClient();
  const { id, data, ann, paint, videoRef, captureCamera, loadComments, loop, fps } = opts;

  return async (text: string, files: File[]): Promise<boolean> => {
    const kind = data?.media.kind;
    // In→out range (34.A): the active I/O loop at send time becomes the comment's range
    // (annotation visible across the whole range); the marker anchors at the entry point.
    const range =
      kind === 'VIDEO' && loop && loop.in != null && loop.out != null && loop.out > loop.in
        ? { inFrame: Math.round(loop.in * (fps || 24)), outFrame: Math.round(loop.out * (fps || 24)) }
        : null;
    let timestamp = kind === 'VIDEO' && videoRef.current ? videoRef.current.currentTime : undefined;
    if (range && loop) timestamp = loop.in!;
    const cameraState = kind === 'MODEL_3D' || kind === 'SPLAT' ? captureCamera() : undefined;
    // The images of the points and those of the composer leave together: the plan decides the order
    // (points first) and what falls at the ceiling.
    const spatial = kind === 'MODEL_3D' || kind === 'SPLAT';
    const poiPoints = spatial ? ann.poi.points : [];
    const plan = poiUploadPlan(poiPoints, files);
    // Annotation: 3D/splat = points of interest + 2D drawings; others = 2D drawings.
    let annotation: unknown;
    if (spatial) {
      const parts: unknown[] = [];
      // Strokes of the surface brush (V9): both spatial types since batch 13 — the brush had stayed on
      // the splat, and a stroke painted on a model would not have been sent.
      parts.push(...paint.serializePending());
      // Layout mode: camera animation (F-curves v2) attached to the comment (instead of drawing).
      //
      // The part IS the animation, spread as is. It used to be copied field by field (`version`, `loop`,
      // `channels`), and `durationMs` — the adjustable playback duration, Phase 27 — stayed on the dock:
      // the animation arrived, but looped on its last key time instead of the wanted duration. A replay
      // that is not identical is a lost presentation. `CameraAnimV2` and `cameraAnimShape` (Zod) describe
      // the same shape, with the same four fields: nothing foreign can leave for a `strict()` schema, and
      // a field added tomorrow travels without anyone having to think about it here.
      if (ann.cameraAnim) parts.push({ type: 'camera-anim', ...ann.cameraAnim });
      // 3D scene proposal (46.D): the reviewer's local edits travel with the comment and are only
      // replayed on its selection — the shared scene does not move.
      if (ann.sceneOverride) parts.push({ type: 'scene-override', override: ann.sceneOverride });
      parts.push(...ann.annot);
      annotation = parts.length ? parts : undefined;
    } else {
      annotation = ann.annot.length ? ann.annot : undefined;
    }
    // Video range: `range` part added to the annotation (created if needed).
    if (range) {
      const parts = Array.isArray(annotation) ? [...annotation] : [];
      parts.push({ type: 'range', ...range });
      annotation = parts;
    }
    try {
      if (plan.dropped > 0) toast.warning(t('poi.imagesDropped', { count: plan.dropped }));
      const uploaded = plan.files.length > 0 ? await uploadCommentAttachments(plan.files) : [];
      // Point-cloud edit proposal (batch 14): same mechanism as the 3D scene, for the other spatial
      // viewer. Since the lock closes global writes at publication, this is how a splat edit reaches
      // the others — replayed when the comment is read, never written into the media.
      //
      // It is assembled HERE, for the same reason as the `poi` part: its two binaries (deletion mask,
      // subset ops) are attachments of the comment, and their keys only exist once uploaded.
      const draft = kind === 'SPLAT' ? ann.takeSplatEdit() : null;
      const blobs = await uploadSplatEditBlobs(draft, uploaded.length);
      if (blobs.dropped === 'size') toast.warning(t('splat.proposalTooLarge'));
      if (blobs.dropped === 'room') toast.warning(t('splat.proposalNoRoom'));
      const splatPart = buildSplatEditPart(draft?.edits ?? null, blobs.refs);
      if (splatPart) annotation = [...(Array.isArray(annotation) ? annotation : []), splatPart];
      const attachments = [...uploaded, ...blobs.attachments];
      // The `poi` part can only be assembled HERE: the keys of the images only exist after the upload,
      // and it is through them that a point recognizes its own.
      const poi = buildPoiPart(poiStoredPoints(poiPoints, plan, uploaded));
      if (poi) annotation = [poi, ...(Array.isArray(annotation) ? annotation : [])];
      const { comment } = await api.post<{ comment: ReviewComment }>('/api/comments', {
        mediaObjectId: id,
        // Optional text (annotation only): minimal placeholder for the backend constraint.
        content: poiContent(text, poiPoints, annotation ? '(annotation)' : '(image)'),
        timestamp,
        cameraState,
        annotation,
        attachments: attachments.length > 0 ? attachments : undefined,
      });
      await linkStagedReferences(qc, id, ann, comment.id);
      ann.resetComposer();
      paint.clearPending();
      await loadComments();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('comment.sendFailed'));
      return false;
    }
  };
}

/** Reference images in preparation → linked to the created comment, position frozen. */
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
      toast.error(e instanceof Error ? e.message : translate('comment.refImageFailed'));
    }
  }
}
