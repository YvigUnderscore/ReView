import { randomUUID } from 'node:crypto';
import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { storage } from './StorageService';
import { detectImage } from '../lib/fileSignatures';
import { badRequest, notFound } from '../lib/errors';
import { assertMediaManage } from './MediaService';

/**
 * Images de référence d'une review 2D (Phase 24, multi-items) : **persistées & partagées**
 * (tous les spectateurs les voient), épinglées au canvas de la review image — coordonnées en
 * fractions de l'image de base, débordement autorisé autour. Aide de review → **non soumises
 * au verrou de publication** ; gestion réservée aux gestionnaires du média, lecture ouverte
 * aux membres du projet.
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

async function serialize(ref: { id: number; storageKey: string; x: number; y: number; width: number }) {
  return {
    id: ref.id,
    url: await storage.getPresignedGetUrl(ref.storageKey),
    x: ref.x,
    y: ref.y,
    width: ref.width,
  };
}

/** Ajoute une image de référence (data URL) au canvas. Gestionnaire du média uniquement. */
export async function add(
  user: SessionUser,
  mediaId: number,
  dataUrl: string,
  pos?: { x?: number; y?: number; width?: number },
) {
  await assertMediaManage(mediaId, user);
  const count = await prisma.reviewReference.count({ where: { mediaObjectId: mediaId } });
  if (count >= MAX_REFS)
    throw badRequest(`${MAX_REFS} images de référence max par média`, 'TOO_MANY_REFERENCES');
  const { buf, ext, contentType } = decodeImageDataUrl(dataUrl);
  const key = `derived/${mediaId}/reference-${randomUUID()}.${ext}`;
  await storage.putObject(key, buf, contentType);
  const ref = await prisma.reviewReference.create({
    data: {
      mediaObjectId: mediaId,
      storageKey: key,
      createdById: user.id,
      x: clampPos(pos?.x ?? 1.05 + count * 0.03),
      y: clampPos(pos?.y ?? count * 0.03),
      width: clampWidth(pos?.width ?? 0.3),
    },
  });
  return serialize(ref);
}

/** Met à jour la position/taille (fractions de l'image de base). Gestionnaire uniquement. */
export async function updatePosition(
  user: SessionUser,
  mediaId: number,
  refId: number,
  pos: { x: number; y: number; width: number },
) {
  await assertMediaManage(mediaId, user);
  const existing = await prisma.reviewReference.findUnique({ where: { id: refId } });
  if (!existing || existing.mediaObjectId !== mediaId) throw notFound('Image de référence introuvable');
  const ref = await prisma.reviewReference.update({
    where: { id: refId },
    data: { x: clampPos(pos.x), y: clampPos(pos.y), width: clampWidth(pos.width) },
  });
  return serialize(ref);
}

/** Supprime une image de référence (DB + MinIO). Gestionnaire du média uniquement. */
export async function remove(user: SessionUser, mediaId: number, refId: number) {
  await assertMediaManage(mediaId, user);
  const ref = await prisma.reviewReference.findUnique({ where: { id: refId } });
  if (!ref || ref.mediaObjectId !== mediaId) return;
  await prisma.reviewReference.delete({ where: { id: refId } });
  await storage.deleteObject(ref.storageKey).catch(() => undefined);
}
