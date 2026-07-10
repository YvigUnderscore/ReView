import { MediaKind, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { storage, StorageService } from './StorageService';
import { badRequest, notFound } from '../lib/errors';
import { assertMediaManage } from './MediaService';

/**
 * Éditions non-destructives d'un splat (10.G) : transformation TRS + volumes de crop SDF
 * (JSON `metadata.splatEdits`) et masque de suppression par splat (bitset binaire dans MinIO,
 * référencé par `metadata.splatMaskKey`). Le fichier splat original n'est jamais modifié ;
 * les éditions sont ré-appliquées au chargement du viewer. Écriture réservée aux gestionnaires ;
 * **autorisée même après publication** (10.G-V10) — toute écriture sur un média publié pose le
 * marqueur `editedAfterPublishAt/ById` (badge « modifié après publication » côté review).
 */

type SessionUser = { id: number; role: import('@prisma/client').Role };

export interface SplatTransformInput {
  position: [number, number, number];
  quaternion: [number, number, number, number];
  scale: [number, number, number];
}

export interface SdfVolumeInput {
  shape: 'box' | 'sphere';
  mode: 'delete' | 'isolate';
  position: [number, number, number];
  quaternion: [number, number, number, number];
  scale: [number, number, number];
}

export interface SplatEditsInput {
  transform: SplatTransformInput | null;
  volumes: SdfVolumeInput[];
}

const MAX_MASK_BYTES = 4_000_000;

/** Gestionnaire + splat — l'édition reste autorisée après publication (marqueur posé, V10). */
async function assertEditableSplat(user: SessionUser, id: number) {
  await assertMediaManage(id, user);
  const media = await prisma.mediaObject.findUnique({
    where: { id },
    select: { metadata: true, kind: true, published: true },
  });
  if (!media) throw notFound('Média introuvable');
  if (media.kind !== MediaKind.SPLAT) throw badRequest('Édition réservée aux splats', 'NOT_SPLAT');
  return media;
}

/** Marqueur « modifié après publication » (fusionné au metadata si le média est publié). */
function editedMarker(user: SessionUser, media: { published: boolean }) {
  return media.published
    ? { editedAfterPublishAt: new Date().toISOString(), editedAfterPublishById: user.id }
    : {};
}

/**
 * Enregistre (ou efface si null) la présentation persistée du splat (10.G-V5) : caméra de
 * base, profondeur de champ, reveal, LOD par défaut, animation caméra keyframe. Écrite par un
 * gestionnaire et **rejouée pour tous** à l'ouverture ; contrairement aux éditions, elle reste
 * modifiable après publication (mise en scène de la review, le média n'est pas altéré).
 */
export async function setSplatPresentation(user: SessionUser, id: number, presentation: object | null) {
  await assertMediaManage(id, user);
  const media = await prisma.mediaObject.findUnique({
    where: { id },
    select: { metadata: true, kind: true },
  });
  if (!media) throw notFound('Média introuvable');
  if (media.kind !== MediaKind.SPLAT) throw badRequest('Présentation réservée aux splats', 'NOT_SPLAT');
  const metadata = {
    ...((media.metadata ?? {}) as object),
    splatPresentation: presentation as Prisma.InputJsonValue | null,
  } as Prisma.InputJsonObject;
  await prisma.mediaObject.update({ where: { id }, data: { metadata } });
  return { splatPresentation: presentation };
}

/** Enregistre (ou efface si null/vide) les éditions JSON — transformation TRS + volumes. */
export async function setSplatEdits(user: SessionUser, id: number, edits: SplatEditsInput | null) {
  const media = await assertEditableSplat(user, id);
  const value = edits && (edits.transform || edits.volumes.length > 0) ? edits : null;
  const marker = editedMarker(user, media);
  const metadata = {
    ...((media.metadata ?? {}) as object),
    splatEdits: value,
    ...marker,
  } as Prisma.InputJsonObject;
  await prisma.mediaObject.update({ where: { id }, data: { metadata } });
  return { splatEdits: value, ...marker };
}

/** Enregistre le masque de suppression (bitset base64 → MinIO) et référence sa clé. */
export async function setSplatMask(user: SessionUser, id: number, dataBase64: string, count: number) {
  const media = await assertEditableSplat(user, id);
  const buf = Buffer.from(dataBase64, 'base64');
  if (buf.length === 0 || buf.length > MAX_MASK_BYTES)
    throw badRequest('Masque vide ou trop volumineux', 'INVALID_MASK');
  const key = StorageService.splatMaskKey(id);
  await storage.putObject(key, buf, 'application/octet-stream');
  const marker = editedMarker(user, media);
  const metadata = {
    ...((media.metadata ?? {}) as object),
    splatMaskKey: key,
    splatMaskCount: count,
    ...marker,
  } as Prisma.InputJsonObject;
  await prisma.mediaObject.update({ where: { id }, data: { metadata } });
  return { splatMaskUrl: await storage.getPresignedGetUrl(key), splatMaskCount: count, ...marker };
}

/** Efface le masque de suppression (métadonnées d'abord, objet MinIO en best-effort). */
export async function clearSplatMask(user: SessionUser, id: number) {
  const media = await assertEditableSplat(user, id);
  const meta: Record<string, unknown> = {
    ...((media.metadata ?? {}) as Record<string, unknown>),
    ...editedMarker(user, media),
  };
  const key = typeof meta.splatMaskKey === 'string' ? meta.splatMaskKey : null;
  delete meta.splatMaskKey;
  delete meta.splatMaskCount;
  await prisma.mediaObject.update({
    where: { id },
    data: { metadata: meta as Prisma.InputJsonObject },
  });
  if (key) await storage.deleteObject(key).catch(() => undefined);
  return { splatMaskUrl: null };
}
