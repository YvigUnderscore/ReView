// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { isImageAttachment, type CommentAttachment } from '../../../lib/commentAttachments';

/**
 * Pièces jointes d'un composeur : celles déjà stockées (édition d'un commentaire) et les
 * fichiers encore locaux, ramenées à une seule liste affichable.
 *
 * Avant envoi, une pièce jointe n'était identifiée que par son nom de fichier : impossible
 * de vérifier ce qu'on envoie quand la capture s'appelle « image (3).png ». On lui donne
 * donc une URL — présignée pour l'existant, `blob:` pour le fichier en attente.
 */
export interface AttachmentDraft {
  /** Identifiant de retrait : la clé MinIO d'une pièce déjà stockée, `file:<index>` sinon. */
  id: string;
  name: string;
  contentType?: string;
  /** URL d'affichage, ou `null` tant que la vignette locale n'est pas prête. */
  url: string | null;
}

/** Un fichier encore local n'a pas de clé, seulement une place dans la liste d'attente. */
export const fileDraftId = (index: number): string => `file:${index}`;

/** Index du fichier local désigné, ou `null` si l'identifiant vise une pièce déjà stockée. */
export function fileIndexOf(id: string): number | null {
  const match = /^file:(\d+)$/.exec(id);
  return match ? Number(match[1]) : null;
}

/** Fusionne les deux lots dans l'ordre d'affichage : l'existant d'abord, l'ajout ensuite. */
export function toDrafts(
  existing: readonly CommentAttachment[],
  files: readonly File[],
  previews: readonly string[],
): AttachmentDraft[] {
  return [
    ...existing.map((a) => ({
      id: a.key,
      name: a.name ?? '',
      contentType: a.contentType,
      url: a.url ?? null,
    })),
    ...files.map((f, i) => ({
      id: fileDraftId(i),
      name: f.name,
      contentType: f.type,
      url: previews[i] ?? null,
    })),
  ];
}

/** Retire la pièce désignée du bon lot, sans toucher à l'autre. */
export function removeDraft(
  id: string,
  files: readonly File[],
  existing: readonly CommentAttachment[],
): { files: File[]; existing: CommentAttachment[] } {
  const index = fileIndexOf(id);
  return index === null
    ? { files: [...files], existing: existing.filter((a) => a.key !== id) }
    : { files: files.filter((_, i) => i !== index), existing: [...existing] };
}

/** Vignettes ouvrables en carrousel : les images dont on a effectivement une URL. */
export const imageDrafts = (drafts: readonly AttachmentDraft[]): AttachmentDraft[] =>
  drafts.filter((d) => !!d.url && isImageAttachment(d.contentType));
