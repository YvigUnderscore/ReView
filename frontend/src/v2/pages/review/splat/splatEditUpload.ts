// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { api } from '../../../../lib/apiClient';
import { MAX_COMMENT_ATTACHMENTS, type CommentAttachment } from '../../../../lib/commentAttachments';
import { t } from '../../../i18n';
import type { SplatEditBlob, SplatEditBlobRef, SplatEditDraft } from './splatEditPart';

/**
 * Dépôt des deux binaires d'une proposition d'édition de nuage (Phase 50, lot 14) : le masque
 * de suppression et les ops de sous-ensemble.
 *
 * Ils partent comme des **pièces jointes du commentaire** : même présignature, même dossier,
 * et donc même purge quand le commentaire est édité ou supprimé. La part `splat-edit` n'en
 * gardera que la clé, et c'est le serveur qui vérifie ensuite que chaque clé déclarée est bien
 * l'une des pièces du commentaire, existe, et tient sous le plafond.
 *
 * Deux refus se décident ICI, avant tout téléversement, parce qu'ils se disent mieux à
 * l'auteur qu'après un 400 : le blob trop lourd, et le commentaire qui n'a plus de place dans
 * sa liste de pièces jointes.
 */

/** Plafond d'un blob — miroir de `MAX_SPLAT_EDIT_BLOB_BYTES` côté serveur (4 Mo). */
export const MAX_SPLAT_EDIT_BLOB_BYTES = 4_000_000;

const BLOB_TYPE = 'application/octet-stream';
/**
 * Noms des deux objets. Ils sont concaténés à l'extension plutôt qu'interpolés : un gabarit
 * ferait passer ces noms de fichiers pour du texte d'interface aux yeux de `check-untranslated`.
 */
const MASK_NAME = 'splat-mask.bin';
const SUBSET_NAME = 'splat-subset.bin';

/** Ce que le dépôt rend : les références à poser dans la part, et les pièces à déclarer. */
export interface SplatEditUpload {
  refs: { mask: SplatEditBlobRef | null; subset: SplatEditBlobRef | null };
  attachments: CommentAttachment[];
  /** Pourquoi les binaires sont restés au sol, le cas échéant — l'appelant le dit à l'auteur. */
  dropped: 'size' | 'room' | null;
}

const NOTHING: SplatEditUpload = { refs: { mask: null, subset: null }, attachments: [], dropped: null };

/**
 * Téléverse les binaires de la proposition. Rien à déposer ⇒ rien n'est appelé : une
 * proposition qui ne supprime rien ne doit pas coûter une requête.
 *
 * `slotsUsed` est le nombre de pièces jointes que le commentaire porte déjà (images des points
 * d'intérêt, pièces du composeur) : les deux blobs entrent dans la même liste, donc dans le
 * même plafond.
 */
export async function uploadSplatEditBlobs(
  draft: SplatEditDraft | null,
  slotsUsed: number,
): Promise<SplatEditUpload> {
  const blobs: Array<[keyof SplatEditUpload['refs'], SplatEditBlob, string]> = [];
  if (draft?.mask) blobs.push(['mask', draft.mask, MASK_NAME]);
  if (draft?.subset) blobs.push(['subset', draft.subset, SUBSET_NAME]);
  if (blobs.length === 0) return NOTHING;
  if (blobs.some(([, blob]) => blob.bytes.byteLength > MAX_SPLAT_EDIT_BLOB_BYTES))
    return { ...NOTHING, dropped: 'size' };
  if (slotsUsed + blobs.length > MAX_COMMENT_ATTACHMENTS) return { ...NOTHING, dropped: 'room' };

  const out: SplatEditUpload = { refs: { mask: null, subset: null }, attachments: [], dropped: null };
  for (const [which, blob, name] of blobs) {
    const key = await putBlob(blob.bytes, name);
    out.refs[which] = { key, count: blob.count };
    out.attachments.push({ key, name, contentType: BLOB_TYPE });
  }
  return out;
}

/** Présignature puis PUT direct MinIO — le même chemin que n'importe quelle pièce jointe. */
async function putBlob(bytes: Uint8Array, filename: string): Promise<string> {
  const { url, key } = await api.post<{ url: string; key: string }>('/api/comments/attachments/presign', {
    filename,
    contentType: BLOB_TYPE,
  });
  // Le corps passe par un `Blob` : `fetch` n'accepte une vue typée que si elle porte sur un
  // `ArrayBuffer` bien à elle, ce qu'un masque encodé ne garantit pas. La recopie est le prix
  // d'un appel qui compile sans forcer le type.
  const body = new Blob([new Uint8Array(bytes)], { type: BLOB_TYPE });
  const put = await fetch(url, { method: 'PUT', body, headers: { 'Content-Type': BLOB_TYPE } });
  if (!put.ok) throw new Error(t('splat.proposalUploadFailed'));
  return key;
}
