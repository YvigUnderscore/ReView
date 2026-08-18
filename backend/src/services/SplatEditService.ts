// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MediaKind, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { storage, StorageService } from './StorageService';
import { badRequest, notFound } from '../lib/errors';
import { assertNotPublished } from '../lib/publishLock';
import { assertMediaManage } from './MediaService';

/**
 * Éditions non-destructives d'un splat (10.G) : transformation TRS + volumes de crop SDF
 * (JSON `metadata.splatEdits`) et masque de suppression par splat (bitset binaire dans MinIO,
 * référencé par `metadata.splatMaskKey`). Le fichier splat original n'est jamais modifié ;
 * les éditions sont ré-appliquées au chargement du viewer. Écriture réservée aux gestionnaires,
 * **splat non publié uniquement** (verrou Phase 11) — seule la présentation (mise en scène)
 * reste modifiable après publication.
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
  /** Flip d'orientation à l'import (11.E) : true/absent = convention Y-down redressée. */
  baseFlip?: boolean;
}

const MAX_MASK_BYTES = 4_000_000;

/** Gestionnaire + splat non publié (verrou Phase 11 : un média publié est figé). */
async function assertEditableSplat(user: SessionUser, id: number) {
  await assertMediaManage(id, user);
  const media = await prisma.mediaObject.findUnique({
    where: { id },
    select: { metadata: true, kind: true, published: true },
  });
  if (!media) throw notFound('Media not found');
  if (media.kind !== MediaKind.SPLAT) throw badRequest('Editing is for splats only', 'NOT_SPLAT');
  assertNotPublished(media);
  return media;
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
  if (!media) throw notFound('Media not found');
  // Présentation caméra générique (rejouée pour tous) : splat ET modèle 3D Three (Phase 15).
  // Le champ garde le nom `splatPresentation` (réutilisé) ; DoF/reveal/LOD restent propres au splat.
  if (media.kind !== MediaKind.SPLAT && media.kind !== MediaKind.MODEL_3D)
    throw badRequest('Staging is for 3D and splat media only', 'NOT_3D');
  const metadata = {
    ...((media.metadata ?? {}) as object),
    splatPresentation: presentation,
  } as Prisma.InputJsonObject;
  await prisma.mediaObject.update({ where: { id }, data: { metadata } });
  return { splatPresentation: presentation };
}

/** Enregistre (ou efface si null/vide) les éditions JSON — transformation TRS + volumes. */
export async function setSplatEdits(user: SessionUser, id: number, edits: SplatEditsInput | null) {
  const media = await assertEditableSplat(user, id);
  // Ne persiste que s'il y a quelque chose à retenir (baseFlip false = override d'orientation).
  const value =
    edits && (edits.transform || edits.volumes.length > 0 || edits.baseFlip === false) ? edits : null;
  const metadata = {
    ...((media.metadata ?? {}) as object),
    splatEdits: value,
  } as Prisma.InputJsonObject;
  await prisma.mediaObject.update({ where: { id }, data: { metadata } });
  return { splatEdits: value };
}

/** Enregistre le masque de suppression (bitset base64 → MinIO) et référence sa clé. */
export async function setSplatMask(user: SessionUser, id: number, dataBase64: string, count: number) {
  const media = await assertEditableSplat(user, id);
  const buf = Buffer.from(dataBase64, 'base64');
  if (buf.length === 0 || buf.length > MAX_MASK_BYTES)
    throw badRequest('Mask is empty or too large', 'INVALID_MASK');
  const key = StorageService.splatMaskKey(id);
  await storage.putObject(key, buf, 'application/octet-stream');
  const metadata = {
    ...((media.metadata ?? {}) as object),
    splatMaskKey: key,
    splatMaskCount: count,
  } as Prisma.InputJsonObject;
  await prisma.mediaObject.update({ where: { id }, data: { metadata } });
  return { splatMaskUrl: await storage.getPresignedGetUrl(key), splatMaskCount: count };
}

/**
 * Enregistre les transformations de sous-ensembles de splats (ops binaires delta+indices,
 * base64 → MinIO) et référence leur clé (Phase 28) — rejouées au chargement pour tous.
 */
export async function setSplatSubsetOps(user: SessionUser, id: number, dataBase64: string, count: number) {
  const media = await assertEditableSplat(user, id);
  const buf = Buffer.from(dataBase64, 'base64');
  if (buf.length === 0 || buf.length > MAX_MASK_BYTES)
    throw badRequest('Transforms are empty or too large', 'INVALID_SUBSET_OPS');
  const key = StorageService.splatSubsetKey(id);
  await storage.putObject(key, buf, 'application/octet-stream');
  const metadata = {
    ...((media.metadata ?? {}) as object),
    splatSubsetKey: key,
    splatSubsetCount: count,
  } as Prisma.InputJsonObject;
  await prisma.mediaObject.update({ where: { id }, data: { metadata } });
  return { splatSubsetUrl: await storage.getPresignedGetUrl(key), splatSubsetCount: count };
}

/** Efface les transformations de sous-ensembles (métadonnées d'abord, MinIO en best-effort). */
export async function clearSplatSubsetOps(user: SessionUser, id: number) {
  const media = await assertEditableSplat(user, id);
  const meta: Record<string, unknown> = {
    ...((media.metadata ?? {}) as Record<string, unknown>),
  };
  const key = typeof meta.splatSubsetKey === 'string' ? meta.splatSubsetKey : null;
  delete meta.splatSubsetKey;
  delete meta.splatSubsetCount;
  await prisma.mediaObject.update({
    where: { id },
    data: { metadata: meta as Prisma.InputJsonObject },
  });
  if (key) await storage.deleteObject(key).catch(() => undefined);
  return { splatSubsetUrl: null };
}

/** Efface le masque de suppression (métadonnées d'abord, objet MinIO en best-effort). */
export async function clearSplatMask(user: SessionUser, id: number) {
  const media = await assertEditableSplat(user, id);
  const meta: Record<string, unknown> = {
    ...((media.metadata ?? {}) as Record<string, unknown>),
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
