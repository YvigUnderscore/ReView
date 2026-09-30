// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { storage } from '../StorageService';
import { safeUploadContentType } from '../../lib/uploadContentType';
import { belongsToProject } from './shotgridProjectGuard';
import { attachmentName, attachmentUrl, asEntityRef, type SgRecord } from './shotgridMapper';
import type { PullContext } from './ShotgridPullService';

/**
 * Pièces jointes d'une note ShotGrid → pièces jointes du commentaire ReView.
 *
 * C'est par là que passe l'image annotée : ShotGrid aplatit le dessin du superviseur et
 * l'attache à la note. Sans ce chemin, la review ne reçoit que le texte, et le retour
 * perd précisément ce qu'il désignait à l'écran.
 *
 * Le fichier est recopié dans le stockage de ReView plutôt que pointé chez ShotGrid :
 * une URL de site expire, exige une authentification, et disparaît avec la note.
 */

const ATTACHMENT_FIELDS = [
  'this_file',
  'filename',
  'display_name',
  // Obligatoire : `belongsToProject` refuse toute entité dont il ne peut pas lire le
  // projet, et un Attachment n'est pas une entité hors-projet.
  'project',
];

/** Au-delà, on n'aspire pas : une note peut porter un rendu entier par mégarde. */
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Alias de type (et non `interface`) à dessein : une interface n'a pas de signature d'index
 * implicite, et Prisma refuse alors de la voir comme une valeur JSON stockable.
 */
export type CommentAttachmentRef = {
  key: string;
  name: string;
  contentType: string;
};

/** Type MIME depuis le nom de fichier, quand le site n'en annonce pas. */
export function guessType(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'pdf') return 'application/pdf';
  return 'application/octet-stream';
}

/**
 * Type retenu pour la pièce jointe rapatriée — celui qui sera stocké **et** enregistré
 * sur le commentaire.
 *
 * Le type annoncé par le transport prime, mais un `application/octet-stream` générique
 * priverait l'image de sa vignette : le nom de fichier tranche alors. Le résultat passe
 * ensuite par la liste blanche, car c'est le site distant qui choisit cet en-tête : un
 * `text/html` ou un `image/svg+xml` seraient servis depuis l'origine de l'application.
 * `putObject` normalise déjà ce qu'il écrit ; on enregistre ici la même valeur, pour que
 * la fiche du commentaire ne promette pas une image que le stockage sert en binaire.
 */
export function storedContentType(announced: string | null | undefined, name: string): string {
  const base = announced?.split(';')[0]?.trim();
  const chosen = base && base !== 'application/octet-stream' ? base : guessType(name);
  return safeUploadContentType(chosen);
}

/**
 * Récupère les pièces jointes d'une note et les pose sur le commentaire.
 *
 * Renvoie le nombre de fichiers effectivement rapatriés. Un échec sur l'un d'eux ne fait
 * pas tomber les autres, ni la note : une pièce jointe manquante est un appauvrissement,
 * pas une raison de perdre le retour lui-même.
 */
export async function importNoteAttachments(
  ctx: PullContext,
  record: SgRecord,
  commentId: number,
): Promise<number> {
  const refs = asRefs(record.attachments);
  if (refs.length === 0) return 0;

  const existing = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { attachments: true },
  });
  const already = Array.isArray(existing?.attachments)
    ? (existing.attachments as unknown as CommentAttachmentRef[])
    : [];
  const known = new Set(already.map((a) => a.key));

  const imported: CommentAttachmentRef[] = [];
  for (const ref of refs) {
    try {
      const one = await fetchOne(ctx, ref.id, commentId);
      if (one && !known.has(one.key)) imported.push(one);
    } catch (err) {
      ctx.journal.count('notes', 'failed');
      await ctx.journal.log(
        'warn',
        'shotgrid.log.noteAttachmentFailed',
        { sgId: ref.id, error: err instanceof Error ? err.message : String(err) },
        { sgType: 'Attachment', sgId: ref.id, localType: 'comment', localId: commentId },
      );
    }
  }
  if (imported.length === 0) return 0;

  await prisma.comment.update({
    where: { id: commentId },
    data: { attachments: [...already, ...imported] as Prisma.InputJsonArray },
  });
  logger.info({ commentId, count: imported.length }, 'Pièces jointes de note importées');
  return imported.length;
}

/** Un fichier : lecture de l'entité, contrôle de projet, téléchargement, dépôt. */
async function fetchOne(
  ctx: PullContext,
  sgId: number,
  commentId: number,
): Promise<CommentAttachmentRef | null> {
  const rec = await ctx.client.findById('Attachment', sgId, ATTACHMENT_FIELDS);
  if (!rec) return null;

  // Même exigence que partout ailleurs : rien n'entre sans que son projet soit vérifié.
  if (!belongsToProject(rec, ctx.scope).ok) {
    ctx.journal.count('guard', 'skipped');
    return null;
  }

  // L'endpoint dédié d'abord, l'adresse portée par le champ ensuite — selon le site et
  // le champ, l'un ou l'autre répond.
  const url = (await ctx.client.downloadUrl('Attachment', sgId, 'this_file')) ?? attachmentUrl(rec.this_file);
  if (!url) return null;

  const name = attachmentName(rec.this_file, `shotgrid-${sgId}`);
  const { stream, size, type } = await ctx.client.openStream(url);
  if (size && size > MAX_BYTES) {
    stream.destroy();
    ctx.journal.count('notes', 'skipped');
    return null;
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    total += (chunk as Buffer).length;
    if (total > MAX_BYTES) {
      stream.destroy();
      ctx.journal.count('notes', 'skipped');
      return null;
    }
    chunks.push(chunk as Buffer);
  }

  const contentType = storedContentType(type, name);

  // Le chemin ne peut pas suivre la convention `comments/attachments/{userId}` : une note
  // importée n'a pas d'auteur local. Il est rangé sous la note d'origine, ce qui reste
  // classé par `AdminStorageService` et dit d'où vient le fichier.
  const key = `comments/attachments/shotgrid/${commentId}/${sgId}-${sanitize(name)}`;
  await storage.putObject(key, Buffer.concat(chunks), contentType);
  return { key, name, contentType };
}

/**
 * Nom de fichier réduit à ce qui peut vivre dans une clé de stockage.
 *
 * Les séquences de points tombent avant le reste : le point seul doit survivre pour
 * garder l'extension — dont dépend le type MIME, donc la vignette — mais « .. » n'a
 * aucune raison d'atteindre une clé qui servira à signer une URL de lecture.
 */
export const sanitize = (name: string): string =>
  name
    .replace(/\.{2,}/g, '_')
    .replace(/[^\w.-]+/g, '_')
    .slice(-80);

export function asRefs(value: unknown): Array<{ id: number; type: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => asEntityRef(v))
    .filter((r): r is { id: number; type: string } => r !== null && r.type === 'Attachment');
}
