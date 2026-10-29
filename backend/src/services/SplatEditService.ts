// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MediaKind, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { storage, StorageService } from '../lib/storage';
import { badRequest, notFound } from '../lib/errors';
import { assertWritable } from '../lib/publishLock';
import { assertMediaManage } from './MediaService';
import { ignoreFailure } from '../lib/ignoreFailure';

/**
 * Non-destructive edits of a splat (10.G): TRS transform + SDF crop volumes (JSON `metadata.splatEdits`)
 * and a per-splat deletion mask (binary bitset in MinIO, referenced by `metadata.splatMaskKey`). The original
 * splat file is never modified; the edits are re-applied when the viewer loads. Writing is reserved to
 * managers, **unpublished splats only** (Phase 11 lock, closed again in Phase 50 batch 14): only the
 * presentation (staging) remains editable after publication. After publication, a cloud edit can only be
 * expressed **in a comment** (part `splat-edit`), replayed when that comment is read and never written here.
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
  /** Orientation flip at import (11.E): true/absent = Y-down convention, straightened. */
  baseFlip?: boolean;
}

const MAX_MASK_BYTES = 4_000_000;

/**
 * Manager and splat media, and publication not yet done.
 *
 * Writing "for everyone" stops at publication, exactly like a version's transform: beyond it, what those who
 * comment see is no longer rewritten under their eyes. The editing gesture remains offered to the reviewer,
 * but in a comment. The lock remains the authority: the `lib/publishLock` table carries the reason.
 */
async function assertEditableSplat(user: SessionUser, id: number) {
  await assertMediaManage(id, user);
  const media = await prisma.mediaObject.findUnique({
    where: { id },
    select: { metadata: true, kind: true, published: true },
  });
  if (!media) throw notFound('Media not found');
  if (media.kind !== MediaKind.SPLAT) throw badRequest('Editing is for splats only', 'NOT_SPLAT');
  assertWritable(media, 'splatEdit');
  return media;
}

/**
 * Saves (or clears if null) the persisted presentation of the splat (10.G-V5): base camera, depth of field,
 * reveal, default LOD, keyframed camera animation. Written by a manager and **replayed for everyone** on opening;
 * unlike the edits, it remains editable after publication (review staging: the media itself is not altered).
 */
export async function setSplatPresentation(user: SessionUser, id: number, presentation: object | null) {
  await assertMediaManage(id, user);
  const media = await prisma.mediaObject.findUnique({
    where: { id },
    select: { metadata: true, kind: true },
  });
  if (!media) throw notFound('Media not found');
  // Generic camera presentation (replayed for everyone): splat AND 3D model Three (Phase 15).
  // The field keeps the name `splatPresentation` (reused); DoF/reveal/LOD remain specific to splats.
  if (media.kind !== MediaKind.SPLAT && media.kind !== MediaKind.MODEL_3D)
    throw badRequest('Staging is for 3D and splat media only', 'NOT_3D');
  const metadata = {
    ...((media.metadata ?? {}) as object),
    splatPresentation: presentation,
  } as Prisma.InputJsonObject;
  await prisma.mediaObject.update({ where: { id }, data: { metadata } });
  return { splatPresentation: presentation };
}

/** Saves (or clears if null/empty) the JSON edits: TRS transform + volumes. */
export async function setSplatEdits(user: SessionUser, id: number, edits: SplatEditsInput | null) {
  const media = await assertEditableSplat(user, id);
  // Only persist if there is something to keep (baseFlip false = orientation override).
  const value =
    edits && (edits.transform || edits.volumes.length > 0 || edits.baseFlip === false) ? edits : null;
  const metadata = {
    ...((media.metadata ?? {}) as object),
    splatEdits: value,
  } as Prisma.InputJsonObject;
  await prisma.mediaObject.update({ where: { id }, data: { metadata } });
  return { splatEdits: value };
}

/** Saves the deletion mask (base64 bitset to MinIO) and references its key. */
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
 * Saves the transforms of splat subsets (delta + index binary ops, base64 to MinIO) and references their
 * key (Phase 28): replayed on load for everyone.
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

/** Clears the subset transforms (metadata first, MinIO on a best-effort basis). */
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
  if (key) await storage.deleteObject(key).catch(ignoreFailure('splat edit object cleanup failed', { key }));
  return { splatSubsetUrl: null };
}

/** Clears the deletion mask (metadata first, MinIO object on a best-effort basis). */
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
  if (key) await storage.deleteObject(key).catch(ignoreFailure('splat edit object cleanup failed', { key }));
  return { splatMaskUrl: null };
}
