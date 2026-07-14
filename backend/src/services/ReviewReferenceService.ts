import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { storage } from './StorageService';
import { detectImage } from '../lib/fileSignatures';
import { badRequest, notFound } from '../lib/errors';
import { assertMediaManage } from './MediaService';

/**
 * Image de référence d'une review 2D (Phase 24) : une par média, **persistée & partagée**
 * (tous les spectateurs la voient), déplaçable/redimensionnable (position en fractions du
 * cadre). Aide de review → **non soumise au verrou de publication** ; gestion réservée aux
 * gestionnaires du média (uploader/superviseur+), lecture ouverte aux membres du projet.
 */

type SessionUser = { id: number; role: Role };

const MAX_BYTES = 6_000_000;

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

async function serialize(ref: { storageKey: string; x: number; y: number; width: number }) {
  return { url: await storage.getPresignedGetUrl(ref.storageKey), x: ref.x, y: ref.y, width: ref.width };
}

/** Dépose/remplace l'image de référence (data URL). Gestionnaire du média uniquement. */
export async function set(user: SessionUser, mediaId: number, dataUrl: string) {
  await assertMediaManage(mediaId, user);
  const { buf, ext, contentType } = decodeImageDataUrl(dataUrl);
  const key = `derived/${mediaId}/reference.${ext}`;
  await storage.putObject(key, buf, contentType);
  const existing = await prisma.reviewReference.findUnique({ where: { mediaObjectId: mediaId } });
  // Nettoie l'ancien objet si l'extension change (clé différente).
  if (existing && existing.storageKey !== key) {
    await storage.deleteObject(existing.storageKey).catch(() => undefined);
  }
  const ref = await prisma.reviewReference.upsert({
    where: { mediaObjectId: mediaId },
    update: { storageKey: key, createdById: user.id },
    create: { mediaObjectId: mediaId, storageKey: key, createdById: user.id },
  });
  return serialize(ref);
}

/** Met à jour la position/taille (fractions du cadre). Gestionnaire du média uniquement. */
export async function updatePosition(
  user: SessionUser,
  mediaId: number,
  pos: { x: number; y: number; width: number },
) {
  await assertMediaManage(mediaId, user);
  if (!(await prisma.reviewReference.findUnique({ where: { mediaObjectId: mediaId } })))
    throw notFound('Image de référence introuvable');
  const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);
  const ref = await prisma.reviewReference.update({
    where: { mediaObjectId: mediaId },
    data: { x: clamp01(pos.x), y: clamp01(pos.y), width: Math.min(Math.max(pos.width, 0.05), 1) },
  });
  return serialize(ref);
}

/** Supprime l'image de référence (DB + MinIO). Gestionnaire du média uniquement. */
export async function remove(user: SessionUser, mediaId: number) {
  await assertMediaManage(mediaId, user);
  const ref = await prisma.reviewReference.findUnique({ where: { mediaObjectId: mediaId } });
  if (!ref) return;
  await prisma.reviewReference.delete({ where: { mediaObjectId: mediaId } });
  await storage.deleteObject(ref.storageKey).catch(() => undefined);
}
