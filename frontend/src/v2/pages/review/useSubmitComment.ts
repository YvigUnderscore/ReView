// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

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
import { buildPoiPart, poiContent } from './poi/poiPoints';
import { poiStoredPoints, poiUploadPlan } from './poi/poiUpload';
import { useT, t as translate } from '../../i18n';

/**
 * Envoi d'un commentaire de review (extrait de ReviewPage, budget 10.F4) : assemble
 * timestamp/caméra/annotation (points d'intérêt + painter + anim caméra + dessins 2D),
 * téléverse les pièces jointes, crée le commentaire puis lie les **images de référence en
 * préparation** (position figée côté serveur). Renvoie true si l'envoi a réussi.
 *
 * **Un seul commentaire part**, quel que soit le nombre de points d'intérêt posés : il porte
 * tous les points (part `poi`), la remarque de chacun recopiée numérotée dans son texte, et
 * leurs images dans la liste de pièces jointes du commentaire. C'est la forme arrêtée avec
 * l'utilisateur, et c'est elle qui laisse le portail client, l'export de notes et le pont
 * ShotGrid inchangés — ils ne lisent que `content`.
 */
export function useSubmitComment(opts: {
  id: number;
  data: MediaResp | null;
  ann: Annotations;
  paint: SplatPaintState;
  videoRef: RefObject<HTMLVideoElement | null>;
  captureCamera: () => unknown;
  loadComments: () => Promise<unknown>;
  /** Boucle I/O active (secondes) : jointe comme plage in→out du commentaire (34.A). */
  loop?: { in: number | null; out: number | null };
  fps?: number;
}) {
  const t = useT();
  const qc = useQueryClient();
  const { id, data, ann, paint, videoRef, captureCamera, loadComments, loop, fps } = opts;

  return async (text: string, files: File[]): Promise<boolean> => {
    const kind = data?.media.kind;
    // Plage in→out (34.A) : la boucle I/O active à l'envoi devient la plage du commentaire
    // (annotation visible pendant toute la plage) ; le marqueur s'ancre au point d'entrée.
    const range =
      kind === 'VIDEO' && loop && loop.in != null && loop.out != null && loop.out > loop.in
        ? { inFrame: Math.round(loop.in * (fps || 24)), outFrame: Math.round(loop.out * (fps || 24)) }
        : null;
    let timestamp = kind === 'VIDEO' && videoRef.current ? videoRef.current.currentTime : undefined;
    if (range && loop) timestamp = loop.in!;
    const cameraState = kind === 'MODEL_3D' || kind === 'SPLAT' ? captureCamera() : undefined;
    // Les images des points et celles du composeur partent ensemble : le plan décide de
    // l'ordre (les points d'abord) et de ce qui tombe au plafond.
    const spatial = kind === 'MODEL_3D' || kind === 'SPLAT';
    const poiPoints = spatial ? ann.poi.points : [];
    const plan = poiUploadPlan(poiPoints, files);
    // Annotation : 3D/splat = points d'intérêt + dessins 2D ; autres = dessins 2D.
    let annotation: unknown;
    if (spatial) {
      const parts: unknown[] = [];
      if (kind === 'SPLAT') parts.push(...paint.serializePending()); // traits du painter (V9)
      // Mode layout : anim caméra (F-curves v2) jointe au commentaire (au lieu de dessiner).
      //
      // La part EST l'animation, étalée telle quelle. Elle était recopiée champ par champ
      // (`version`, `loop`, `channels`), et `durationMs` — la durée de lecture réglable, Phase 27
      // — restait sur le quai : l'animation arrivait bien, mais bouclait sur son dernier temps de
      // clé au lieu de la durée voulue. Un rejeu qui n'est pas à l'identique est une présentation
      // perdue. `CameraAnimV2` et `cameraAnimShape` (Zod) décrivent la même forme, à quatre
      // champs : rien d'étranger ne peut partir vers un schéma `strict()`, et un champ ajouté
      // demain voyage sans qu'on ait à y repenser ici.
      if (ann.cameraAnim) parts.push({ type: 'camera-anim', ...ann.cameraAnim });
      // Proposition de scène 3D (46.D) : les modifications locales du reviewer voyagent avec
      // le commentaire et ne sont rejouées qu'à sa sélection — la scène commune ne bouge pas.
      if (ann.sceneOverride) parts.push({ type: 'scene-override', override: ann.sceneOverride });
      parts.push(...ann.annot);
      annotation = parts.length ? parts : undefined;
    } else {
      annotation = ann.annot.length ? ann.annot : undefined;
    }
    // Plage vidéo : part `range` ajoutée à l'annotation (créée au besoin).
    if (range) {
      const parts = Array.isArray(annotation) ? [...annotation] : [];
      parts.push({ type: 'range', ...range });
      annotation = parts;
    }
    try {
      if (plan.dropped > 0) toast.warning(t('poi.imagesDropped', { count: plan.dropped }));
      const uploaded = plan.files.length > 0 ? await uploadCommentAttachments(plan.files) : [];
      // La part `poi` ne peut être assemblée qu'ICI : les clés des images n'existent qu'après
      // le téléversement, et c'est par elles qu'un point reconnaît les siennes.
      const poi = buildPoiPart(poiStoredPoints(poiPoints, plan, uploaded));
      if (poi) annotation = [poi, ...(Array.isArray(annotation) ? annotation : [])];
      const { comment } = await api.post<{ comment: ReviewComment }>('/api/comments', {
        mediaObjectId: id,
        // Texte optionnel (annotation seule) : placeholder minimal pour la contrainte backend.
        content: poiContent(text, poiPoints, annotation ? '(annotation)' : '(image)'),
        timestamp,
        cameraState,
        annotation,
        attachments: uploaded.length > 0 ? uploaded : undefined,
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
      toast.error(e instanceof Error ? e.message : translate('comment.refImageFailed'));
    }
  }
}
