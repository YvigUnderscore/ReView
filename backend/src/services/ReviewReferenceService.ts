import { randomUUID } from 'node:crypto';
import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { storage } from './StorageService';
import { detectImage } from '../lib/fileSignatures';
import { badRequest, forbidden } from '../lib/errors';
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
// Bornes du canvas : les références peuvent être posées autour de l'image de base.
const POS_MIN = -3;
const POS_MAX = 4;

function decodeImageDataUrl(dataUrl: string): { buf: Buffer; ext: string; contentType: string } {
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/i.exec(dataUrl);
  if (!m) throw badRequest('Image invalide (data URL image attendue)', 'INVALID_IMAGE');
  const contentType = m[1]!.toLowerCase();
  const buf = Buffer.from(m[2]!, 'base64');
  if (buf.length === 0 || buf.length > MAX_BYTES)
    throw badRequest('Image vide ou trop volumineuse (max 6 Mo)', 'INVALID_IMAGE');
  if (!detectImage(buf.subarray(0, 16))) throw badRequest('Contenu non reconnu comme image', 'INVALID_IMAGE');
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

const clampPos = (v: number) => Math.min(Math.max(v, POS_MIN), POS_MAX);
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
 * Ajoute une image de référence (data URL) liée à un commentaire du média. Réservé à
 * l'**auteur du commentaire** (l'accès projet est garanti par l'existence du commentaire,
 * créé sous RBAC). La position est figée à la création.
 */
export async function add(
  user: SessionUser,
  mediaId: number,
  dataUrl: string,
  commentId: number,
  pos?: { x?: number; y?: number; width?: number },
) {
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { mediaObjectId: true, userId: true },
  });
  if (!comment || comment.mediaObjectId !== mediaId) throw badRequest('Commentaire invalide pour ce média');
  if (comment.userId !== user.id)
    throw forbidden("Seul l'auteur du commentaire peut y joindre une référence");
  const count = await prisma.reviewReference.count({ where: { mediaObjectId: mediaId } });
  if (count >= MAX_REFS)
    throw badRequest(`${MAX_REFS} images de référence max par média`, 'TOO_MANY_REFERENCES');
  const { buf, ext, contentType } = decodeImageDataUrl(dataUrl);
  const key = `derived/${mediaId}/reference-${randomUUID()}.${ext}`;
  await storage.putObject(key, buf, contentType);
  const ref = await prisma.reviewReference.create({
    data: {
      mediaObjectId: mediaId,
      commentId,
      storageKey: key,
      createdById: user.id,
      x: clampPos(pos?.x ?? 1.05 + count * 0.03),
      y: clampPos(pos?.y ?? count * 0.03),
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
