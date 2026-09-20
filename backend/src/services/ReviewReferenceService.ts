// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomUUID } from 'node:crypto';
import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { storage } from './StorageService';
import { detectImage } from '../lib/fileSignatures';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { checkProjectAccess } from '../middleware/rbac';
import { assertProjectWritable } from '../lib/projectGuard';
import { resolveProjectIdForMedia } from '../lib/pipeline';
import { assertMediaManage } from './MediaService';

/**
 * Images de référence d'une review 2D (Phase 24, remaniées) : **liées à un commentaire**
 * — elles ne s'affichent que lorsque leur commentaire est sélectionné (fin de l'affichage
 * permanent), et ne sont **plus déplaçables une fois apposées** (position figée à l'envoi
 * du commentaire). Épinglées au canvas en fractions de l'image de base, débordement
 * autorisé. Aide de review → non soumises au verrou de publication. Ajout par l'auteur
 * du commentaire ; suppression par l'auteur ou un gestionnaire du média.
 */

type SessionUser = { id: number; role: Role };

const MAX_BYTES = 6_000_000;
const MAX_REFS = 12;
/**
 * Bornes du canvas : une référence se pose autour de l'image de base (bandes du letterbox),
 * pas seulement dessus. Même plafond que le schéma du routeur (`POS_LIMIT`) — le service
 * reborne parce qu'il sert aussi ses propres valeurs par défaut.
 */
const POS_LIMIT = 3;

function decodeImageDataUrl(dataUrl: string): { buf: Buffer; ext: string; contentType: string } {
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/i.exec(dataUrl);
  if (!m) throw badRequest('Invalid image (an image data URL is expected)', 'INVALID_IMAGE');
  const contentType = m[1]!.toLowerCase();
  const buf = Buffer.from(m[2]!, 'base64');
  if (buf.length === 0 || buf.length > MAX_BYTES)
    throw badRequest('Image is empty or too large (6 MB max)', 'INVALID_IMAGE');
  if (!detectImage(buf.subarray(0, 16)))
    throw badRequest('Content is not a recognised image', 'INVALID_IMAGE');
  const ext =
    contentType === 'image/png'
      ? 'png'
      : contentType === 'image/webp'
        ? 'webp'
        : contentType === 'image/gif'
          ? 'gif'
          : 'jpg';
  return { buf, ext, contentType };
}

const clampPos = (v: number) => Math.min(Math.max(v, -POS_LIMIT), POS_LIMIT);
const clampWidth = (v: number) => Math.min(Math.max(v, 0.02), 3);

async function serialize(ref: {
  id: number;
  storageKey: string;
  x: number;
  y: number;
  width: number;
  commentId: number | null;
}) {
  return {
    id: ref.id,
    url: await storage.getPresignedGetUrl(ref.storageKey),
    x: ref.x,
    y: ref.y,
    width: ref.width,
    commentId: ref.commentId,
  };
}

/**
 * Accès en écriture au média porteur (membre du projet, projet ni retiré ni archivé).
 *
 * La propriété d'un commentaire ne vaut pas autorisation : elle raisonne sur un état
 * passé. Le commentaire survit au retrait du membership, à l'archivage du projet et à sa
 * mise à la corbeille — un prestataire sorti d'un projet terminé rejouait l'un de ses
 * anciens `commentId` et déposait encore jusqu'à 6 Mo sous le préfixe `derived/` du
 * studio. L'accès se revérifie donc au moment du geste, comme sur le routeur voisin
 * (`TimelineMarkerService.assertMediaRead`).
 */
async function assertMediaWrite(mediaId: number, user: SessionUser): Promise<void> {
  const projectId = await resolveProjectIdForMedia(mediaId);
  if (!projectId) throw notFound('Media not found');
  if (!(await checkProjectAccess(user.id, user.role, projectId)))
    throw forbidden('No access to this project');
  await assertProjectWritable(projectId);
}

/**
 * Ajoute une image de référence (data URL) liée à un commentaire du média. Réservé à
 * l'**auteur du commentaire**, et seulement tant qu'il a accès au projet. La position est
 * figée à la création.
 */
export async function add(
  user: SessionUser,
  mediaId: number,
  dataUrl: string,
  commentId: number,
  pos?: { x?: number; y?: number; width?: number },
) {
  await assertMediaWrite(mediaId, user);
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { mediaObjectId: true, userId: true },
  });
  if (!comment || comment.mediaObjectId !== mediaId)
    throw badRequest('This comment does not belong to this media');
  if (comment.userId !== user.id)
    throw forbidden("Seul l'auteur du commentaire peut y joindre une référence");
  const count = await prisma.reviewReference.count({ where: { mediaObjectId: mediaId } });
  if (count >= MAX_REFS)
    throw badRequest(`At most ${MAX_REFS} reference images per media`, 'TOO_MANY_REFERENCES');
  const { buf, ext, contentType } = decodeImageDataUrl(dataUrl);
  const key = `derived/${mediaId}/reference-${randomUUID()}.${ext}`;
  await storage.putObject(key, buf, contentType);
  const ref = await prisma.reviewReference.create({
    data: {
      mediaObjectId: mediaId,
      commentId,
      storageKey: key,
      createdById: user.id,
      // Sans position (client hors écran de review) : juste à droite du cadre, là où le
      // letterbox laisse d'ordinaire de la place. Faute de bande chez le lecteur, l'affichage
      // la ramènera contre le bord droit du média.
      x: clampPos(pos?.x ?? 1.02 + count * 0.03),
      y: clampPos(pos?.y ?? 0.02 + count * 0.03),
      width: clampWidth(pos?.width ?? 0.3),
    },
  });
  return serialize(ref);
}

/** Supprime une image de référence (DB + MinIO). Auteur du commentaire ou gestionnaire. */
export async function remove(user: SessionUser, mediaId: number, refId: number) {
  const ref = await prisma.reviewReference.findUnique({
    where: { id: refId },
    include: { comment: { select: { userId: true } } },
  });
  if (!ref || ref.mediaObjectId !== mediaId) return;
  if (ref.comment?.userId !== user.id) await assertMediaManage(mediaId, user);
  await prisma.reviewReference.delete({ where: { id: refId } });
  await storage.deleteObject(ref.storageKey).catch(() => undefined);
}

/** Purge MinIO des références d'un commentaire (avant sa suppression — cascade DB). */
export async function purgeForComment(commentId: number) {
  const refs = await prisma.reviewReference.findMany({ where: { commentId }, select: { storageKey: true } });
  await Promise.all(refs.map((r) => storage.deleteObject(r.storageKey).catch(() => undefined)));
}
