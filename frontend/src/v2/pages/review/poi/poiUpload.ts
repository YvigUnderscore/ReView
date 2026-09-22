// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  isAllowedAttachment,
  MAX_COMMENT_ATTACHMENTS,
  type CommentAttachment,
} from '../../../../lib/commentAttachments';
import type { PoiDraft } from './usePoiDraft';
import type { PoiPoint } from './poiPoints';

/**
 * Les images des points partent dans la MÊME liste de pièces jointes que celles du composeur :
 * un seul téléversement — celui du lot 5 — et un seul commentaire porteur. Chaque point note
 * ensuite lesquelles sont les siennes, par leur clé.
 *
 * Tout le travail délicat est ici, et il est pur : décider quels fichiers partent, dans quel
 * ordre, et lesquels sont perdus au plafond. Le téléversement, lui, ne fait que suivre le plan.
 */
export interface PoiUploadPlan {
  /** Fichiers à téléverser, dans cet ordre : ceux des points d'abord, puis ceux du composeur. */
  files: File[];
  /** Nombre de pièces retenues par point, dans l'ordre des points. */
  counts: number[];
  /** Fichiers écartés (type refusé ou plafond atteint) — l'appelant le dit à l'auteur. */
  dropped: number;
}

/**
 * Les images des POINTS passent devant : l'image d'un point EST sa remarque, alors qu'une pièce
 * du composeur se rejoint d'un message suivant. Les fichiers d'un type refusé sont écartés ici,
 * avant l'envoi — c'est ce qui garantit que le téléversement rend **une pièce par fichier, dans
 * l'ordre**, et donc que la répartition par clé est exacte.
 */
export function poiUploadPlan(
  points: readonly PoiDraft[],
  extra: readonly File[],
  max: number = MAX_COMMENT_ATTACHMENTS,
): PoiUploadPlan {
  const files: File[] = [];
  const counts: number[] = [];
  let dropped = 0;
  const take = (file: File): boolean => {
    if (!isAllowedAttachment(file.type) || files.length >= max) {
      dropped += 1;
      return false;
    }
    files.push(file);
    return true;
  };
  for (const point of points) {
    let kept = 0;
    for (const file of point.files) if (take(file)) kept += 1;
    counts.push(kept);
  }
  for (const file of extra) take(file);
  return { files, counts, dropped };
}

/**
 * Points prêts à être stockés : la géométrie, la remarque, et les clés des pièces qui leur
 * reviennent — découpées dans l'ordre du plan.
 */
export function poiStoredPoints(
  points: readonly PoiDraft[],
  plan: PoiUploadPlan,
  uploaded: readonly CommentAttachment[],
): PoiPoint[] {
  let at = 0;
  return points.map((point, i) => {
    const images = uploaded.slice(at, at + (plan.counts[i] ?? 0)).map((a) => a.key);
    at += plan.counts[i] ?? 0;
    const text = point.text.trim();
    return {
      position: point.position,
      normal: point.normal,
      ...(point.space ? { space: point.space } : {}),
      ...(text ? { text } : {}),
      ...(images.length ? { images } : {}),
    };
  });
}
