// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MediaStatus, Role, VersionStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { nextVersionName } from '../lib/versionNaming';
import { storage } from './StorageService';
import * as MediaService from './MediaService';
import { softDeleteVersion, restoreVersion, purgeVersion } from '../lib/trash';
import { logAudit } from './AuditService';
import { emitToProject } from './SocketService';
import { forbidden, notFound } from '../lib/errors';
import { assertWritable } from '../lib/publishLock';
import { assertProjectWritable } from '../lib/projectGuard';
import { assertCanContribute, assertProjectManage, isProjectManager } from '../lib/projectRoles';
import { versionSelect, toVersion } from '../lib/v1Resources';
import * as ApiEventService from './ApiEventService';

/**
 * Business logic for versions (list with media count respecting visibility, creation XOR Task/Asset, publication
 * reserved to supervisor+, trash). Project access (RBAC) is asserted in the route (10.D8).
 *
 * Rights are read from the EFFECTIVE role (38.E, `lib/projectRoles`) and never from the global role: the second model
 * that lived here refused a supervisor promoted from ARTIST on their project from publishing or deleting a version of
 * THIS project, and let an ARTIST demoted to CLIENT create one.
 */

type SessionUser = { id: number; role: Role };

/** Emits the real-time version update event to the project. */
function emitVersionUpdate(
  projectId: number,
  v: { id: number; taskId: number | null; assetId: number | null },
) {
  emitToProject(projectId, 'version:update', { projectId, id: v.id, taskId: v.taskId, assetId: v.assetId });
}

/**
 * Change stream (v1 journal + webhooks), emitted FROM the service.
 *
 * `version.published` only came from the v1 route: a publication made on screen, through a batch patch or through a
 * media's publication flow produced neither a journal line nor a webhook. Yet it is the event a studio subscribes to first.
 *
 * The representation is that of the v1 API, the same one a subscriber receives for a publication coming from a DCC.
 */
async function publishVersionEvent(
  event: 'version.created' | 'version.published',
  projectId: number,
  versionId: number,
  actorId: number,
): Promise<void> {
  const row = await prisma.version.findUnique({ where: { id: versionId }, select: versionSelect });
  if (!row) return;
  ApiEventService.publish(event, {
    projectId,
    entityType: 'version',
    entityId: versionId,
    actorId,
    payload: { version: toVersion(row) },
  });
}

/** Versions of a Task or an Asset. Media count aligned with real visibility. */
export async function list(userId: number, taskId?: number, assetId?: number) {
  const versions = await prisma.version.findMany({
    where: taskId ? { taskId, deletedAt: null } : { assetId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    include: {
      author: { select: { id: true, name: true } },
      reviewStatus: true, // current review decision (Phase 31)
            // Trash excluded; drafts visible only to their uploader (does not reveal other people's).
      _count: {
        select: { media: { where: { deletedAt: null, OR: [{ published: true }, { uploaderId: userId }] } } },
      },
            // The caller's own drafts: these are the only ones they can publish in one gesture, and
            // the interface need not offer a button that would do nothing (Phase 46).
      media: {
        where: { deletedAt: null, published: false, uploaderId: userId, status: { not: 'UPLOADING' } },
        select: { id: true },
      },
    },
  });
  return versions.map(({ media, ...v }) => ({ ...v, draftCount: media.length }));
}

export interface CreateVersionInput {
  taskId?: number;
  assetId?: number;
  name?: string;
}

/**
 * Name of the next version, in the project's convention.
 *
 * On a project linked to ShotGrid, versions are named after the shot and the step producing them: keeping a local "V02"
 * facing them forces everyone to translate between the two tools in their head. So we read the parent and the step to
 * compose the same code.
 *
 * Names already taken include the trash: a number that has been used must not be reused, even if the version carrying it
 * was deleted.
 */
async function autoName(projectId: number, body: CreateVersionInput): Promise<string> {
  const where = body.taskId ? { taskId: body.taskId } : { assetId: body.assetId };
  const [siblings, connection, task, asset] = await Promise.all([
    prisma.version.findMany({ where, select: { name: true } }),
    prisma.shotgridConnection.findUnique({ where: { projectId }, select: { active: true } }),
    body.taskId
      ? prisma.task.findUnique({
          where: { id: body.taskId },
          select: {
            department: true,
            shot: { select: { code: true } },
            asset: { select: { name: true } },
          },
        })
      : null,
    body.assetId ? prisma.asset.findUnique({ where: { id: body.assetId }, select: { name: true } }) : null,
  ]);

  return nextVersionName({
    existing: siblings.map((v) => v.name),
        // A paused connection is still a linked project: the studio's nomenclature need not change shape because
        // synchronization was suspended one afternoon.
    linked: Boolean(connection),
    parentCode: task?.shot?.code ?? task?.asset?.name ?? asset?.name ?? null,
    step: task?.department ?? null,
  });
}

export async function create(user: SessionUser, projectId: number, body: CreateVersionInput) {
  await assertCanContribute(user.id, user.role, projectId); // 38.E: CLIENT = no version
  await assertProjectWritable(projectId); // 38.B
  const name = body.name ?? (await autoName(projectId, body));
  const version = await prisma.version.create({
    data: {
      taskId: body.taskId ?? null,
      assetId: body.assetId ?? null,
      name,
      authorId: user.id,
      status: VersionStatus.DRAFT,
    },
  });
  emitVersionUpdate(projectId, version);
  await publishVersionEvent('version.created', projectId, version.id, user.id);
  return version;
}

/** Version detail + media visible to the user (private drafts). */
export async function getDetail(userId: number, id: number) {
  const version = await prisma.version.findUnique({
    where: { id },
    include: {
      author: { select: { id: true, name: true } },
      reviewStatus: true, // current review decision (Phase 31)
      media: {
        where: { deletedAt: null, OR: [{ published: true }, { uploaderId: userId }] },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          kind: true,
          originalName: true,
          status: true,
          published: true,
          thumbnailKey: true,
        },
      },
    },
  });
  if (!version) throw notFound('Version not found');
    // Presigns the thumbnail of each media (Phase 20: real thumbnails on the timeline).
  const media = await Promise.all(
    version.media.map(async ({ thumbnailKey, ...m }) => ({
      ...m,
      thumbnailUrl: thumbnailKey ? await storage.getPresignedGetUrl(thumbnailKey) : null,
    })),
  );
  return { ...version, media };
}

export interface UpdateVersionInput {
  name?: string;
  status?: VersionStatus;
  transform?: unknown;
}

export async function update(user: SessionUser, projectId: number, id: number, body: UpdateVersionInput) {
  const version = await prisma.version.findUnique({
    where: { id },
    select: { authorId: true, published: true },
  });
  if (!version) throw notFound('Version not found');
  const manager = await isProjectManager(user.id, user.role, projectId);
  const isAuthor = version.authorId === user.id;
  if (!manager && !isAuthor) throw forbidden('Only the author or a supervisor can modify a version');
  if (body.status === VersionStatus.PUBLISHED && !manager)
    throw forbidden('Only a supervisor or administrator can publish a version');
    // ...and leaving the published state is just as reserved. Without this, the lock would only make sense if the
    // author unpublished their version, removing it from the client share link along the way, review decisions included,
    // and then edited it freely, since `assertNotPublished` now only sees a draft.
  if (version.published && body.status !== undefined && body.status !== VersionStatus.PUBLISHED && !manager)
    throw forbidden('Only a supervisor or administrator can unpublish a version');
    // Publication lock: the 3D transform of a published version stays frozen. It is the foundation of the A/B and of
    // annotations anchored to the frame: moving it afterwards would skew everything that refers to it (table in `lib/publishLock`).
    //
    // The conjunction of THIS lock and of the author/manager guard above is what `lib/versionPermissions.canEditVersionTransform`
    // returns to the interface (`permissions` of the media detail): touching either guard requires revisiting it, otherwise the
    // screen would start offering a button that this service refuses.
  if (body.transform !== undefined) assertWritable(version, 'versionTransform');

  const updated = await prisma.version.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.transform !== undefined ? { transform: body.transform as object } : {}),
      ...(body.status !== undefined
        ? { status: body.status, published: body.status === VersionStatus.PUBLISHED }
        : {}),
    },
  });
  if (body.status === VersionStatus.PUBLISHED)
    logAudit({ userId: user.id, action: 'VERSION_PUBLISH', entityType: 'Version', entityId: id });
  emitVersionUpdate(projectId, updated);
    // Only the transition counts: setting PUBLISHED again on an already published version is not a publication,
    // and need not wake the subscribers a second time.
  if (body.status === VersionStatus.PUBLISHED && !version.published)
    await publishVersionEvent('version.published', projectId, id, user.id);
  return updated;
}

/**
 * Publishes, in one gesture, all the drafts of a version (Phase 46).
 *
 * Publishing three files one by one and then the version on top made four clicks for a single intention: "it's ready, show it".
 *
 * Each person publishes only their own uploads, supervisors included: a draft is strictly private to its author, and publishing it
 * on their behalf would expose work they did not choose to show. A supervisor who wants to broadcast the version has the switch to
 * PUBLISHED, which reveals no draft.
 */
export async function publishAll(user: SessionUser, projectId: number, id: number) {
  await assertCanContribute(user.id, user.role, projectId); // 38.E: CLIENT = no publication
  const version = await prisma.version.findUnique({
    where: { id },
    select: { id: true, deletedAt: true, published: true },
  });
  if (!version || version.deletedAt) throw notFound('Version not found');

  const drafts = await prisma.mediaObject.findMany({
    where: {
      versionId: id,
      deletedAt: null,
      published: false,
      uploaderId: user.id,
            // An upload in progress has not been validated yet (magic bytes, antivirus, quotas): it will be
            // published at its finalization if the version already is.
      status: { not: MediaStatus.UPLOADING },
    },
    select: { id: true },
  });
  for (const draft of drafts) await MediaService.publish(user, draft.id);

    // Also catches a version left as a draft although all its media were already published: the case of versions
    // created before this rule.
  await MediaService.syncVersionPublication(id, user.id);
  const updated = await prisma.version.findUniqueOrThrow({ where: { id } });
  emitVersionUpdate(projectId, updated);
    // "Publish all" switches the version without going through `update`: without this line, the most common gesture
    // of the review stayed silent for subscribers.
  if (updated.published && !version.published)
    await publishVersionEvent('version.published', projectId, id, user.id);
  return { version: updated, publishedCount: drafts.length };
}

export async function remove(user: SessionUser, projectId: number, id: number) {
  const version = await prisma.version.findUnique({
    where: { id },
    select: { authorId: true, taskId: true, assetId: true },
  });
  if (!version) throw notFound('Version not found');
  if (!(await isProjectManager(user.id, user.role, projectId)) && version.authorId !== user.id)
    throw forbidden('Only the author or a supervisor can delete a version');
  await softDeleteVersion(id);
  logAudit({ userId: user.id, action: 'VERSION_DELETE', entityType: 'Version', entityId: id });
  emitVersionUpdate(projectId, { id, taskId: version.taskId, assetId: version.assetId });
}

export async function restore(user: SessionUser, projectId: number, id: number) {
  const version = await prisma.version.findUnique({
    where: { id },
    select: { authorId: true, taskId: true, assetId: true },
  });
  if (!version) throw notFound('Version not found');
  if (!(await isProjectManager(user.id, user.role, projectId)) && version.authorId !== user.id)
    throw forbidden('Only the author or a supervisor can restore a version');
  await restoreVersion(id);
  emitVersionUpdate(projectId, { id, taskId: version.taskId, assetId: version.assetId });
}

export async function purge(user: SessionUser, projectId: number, id: number) {
  await assertProjectManage(user.id, user.role, projectId);
  const version = await prisma.version.findUnique({ where: { id }, select: { taskId: true, assetId: true } });
  if (!version) throw notFound('Version not found');
  await purgeVersion(id);
  logAudit({ userId: user.id, action: 'VERSION_PURGE', entityType: 'Version', entityId: id });
  emitVersionUpdate(projectId, { id, taskId: version.taskId, assetId: version.assetId });
}
