// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MediaKind, MediaStatus, Prisma, type Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { badRequest, notFound } from '../lib/errors';
import { assertWritable } from '../lib/publishLock';
import { isEmptySceneOverride, type SceneOverride } from '../lib/sceneOverride';
import { assertMediaManage } from './MediaService';
import { logAudit } from './AuditService';

/**
 * Base override of a 3D scene (Phase 46, 46.D) — `metadata.usdOverride`.
 *
 * Set during the pre-publish by a manager, it is **frozen at publication** then replayed on opening for all viewers: it is the asset's reference staging. After publication,
 * nobody modifies it any more — reviewers propose their changes in a comment (annotation part `scene-override`), which keeps the common scene stable while letting each person
 * explore freely on their own side.
 *
 * No worker job: the override is a delta applied at load time, not a reconversion.
 */

type SessionUser = { id: number; role: Role };

/**
 * Manager + 3D media: same rules as the splat edits.
 *
 * The override is a staging replayed when the viewer loads, of the same nature as `splatPresentation` — already exempted since Phase 11. It therefore remains writable
 * after publication (table in `lib/publishLock`).
 */
async function assertEditableScene(user: SessionUser, id: number) {
  await assertMediaManage(id, user);
  const media = await prisma.mediaObject.findUnique({
    where: { id },
    select: { id: true, kind: true, published: true, status: true, metadata: true },
  });
  if (!media) throw notFound('Media not found');
  if (media.kind !== MediaKind.MODEL_3D) throw badRequest('Overrides are for 3D media only', 'NOT_3D');
  if (media.status === MediaStatus.UPLOADING) throw badRequest('Upload not finalised', 'NOT_FINALIZED');
  assertWritable(media, 'usdOverride');
  return media;
}

/** Saves (or clears) the base override. An empty override is stored as absent. */
export async function setSceneOverride(user: SessionUser, id: number, override: SceneOverride | null) {
  const media = await assertEditableScene(user, id);
  const value = override && !isEmptySceneOverride(override) ? override : null;

  const metadata = {
    ...((media.metadata ?? {}) as object),
    usdOverride: value,
  } as Prisma.InputJsonObject;
  await prisma.mediaObject.update({ where: { id }, data: { metadata } });

  logAudit({
    userId: user.id,
    action: 'MEDIA_USD_OVERRIDE',
    entityType: 'MediaObject',
    entityId: id,
    metadata: { prims: value ? Object.keys(value.prims).length : 0, cleared: value === null },
  });
  return { usdOverride: value };
}
