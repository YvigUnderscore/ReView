// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { env } from '../../config/env';
import { shotgridQueue } from '../JobService';
import { storage } from '../StorageService';
import { mediaSourceKey } from '../MediaService';
import { clientForSiteRecord } from './ShotgridConfigService';
import { writerFor, type ShotgridWriter } from './ShotgridWriter';
import { findVersionByCode } from './ShotgridVersionLookup';
import { toSgDate } from './shotgridMapper';
import { findByLocal, upsertLink } from './shotgridLinks';
import { can, parseSettings } from './shotgridSettings';
import { inverseVersionStatusMap, resolveVersionStatusCode } from './ShotgridStatusSync';
import { pushComment } from './ShotgridNoteSync';
import { pushTaskCreation } from './ShotgridTaskCreate';
import { pushPlaylist } from './ShotgridPlaylistSync';

/**
 * ReView -> ShotGrid writes.
 *
 * Everything goes through the queue: an artist who changes a status must not wait for the remote site, and a ShotGrid outage must not make a local action fail.
 * Each write checks three things before leaving: is the domain open for writing, is the entity linked, and does the remote entity still belong to the linked project.
 */

export type PushJob =
    // Task born in ReView (review feedback): it only existed on our side.
  | { type: 'task-create'; taskId: number; actorId?: number | null }
  | { type: 'task-status'; taskId: number; actorId?: number | null }
  | { type: 'task-dates'; taskId: number; actorId?: number | null }
  | { type: 'task-assignee'; taskId: number; actorId?: number | null }
  | { type: 'shot-status'; shotId: number; actorId?: number | null }
  | { type: 'sequence-status'; sequenceId: number; actorId?: number | null }
  | { type: 'version-status'; versionId: number; actorId?: number | null }
  | { type: 'version-publish'; versionId: number; actorId?: number | null }
  | { type: 'asset-links'; assetId: number; actorId?: number | null }
  | { type: 'asset-status'; assetId: number; actorId?: number | null }
  | {
      type: 'description';
      kind: 'sequence' | 'shot' | 'asset';
      id: number;
      actorId?: number | null;
    }
  | { type: 'comment'; commentId: number; actorId?: number | null }
  | { type: 'playlist'; playlistId: number; actorId?: number | null };

/**
 * Queues a write for the concerned project, if a connection exists.
 *
 * Nothing that happens here must make the user's action fail: posting a review decision, changing a status or publishing remains a ReView operation, whether or not
 * ShotGrid is reachable. An incident is logged, and the periodic reconciliation will catch the gap on its next pass.
 */
export async function enqueuePush(projectId: number, job: PushJob): Promise<void> {
  try {
    const conn = await prisma.shotgridConnection.findUnique({ where: { projectId } });
    if (!conn?.active) return;
    await shotgridQueue.add(
      'push',
      { kind: 'push', connectionId: conn.id, push: job },
      { removeOnComplete: 200 },
    );
  } catch (err) {
    logger.warn({ err, projectId, job }, "Écriture ShotGrid non mise en file — l'action locale reste valide");
  }
}

interface PushContext {
  connectionId: number;
  sgProjectId: number;
  sgProjectName: string;
  client: ReturnType<typeof clientForSiteRecord>;
    /** Every write goes through here: see `ShotgridWriter`. */
  writer: ShotgridWriter;
  settings: ReturnType<typeof parseSettings>;
  baseUrl: string;
}

/**
 * ShotGrid identifier of a local entity.
 *
 * It no longer re-reads the target to check its project: it is now `ShotgridWriter` that does so, just before writing, for **all** writes, including those this
 * function did not see go by. The check gained scope and the duplicated read done here disappeared.
 */
async function resolveTarget(
  ctx: PushContext,
  localType: Parameters<typeof findByLocal>[1],
  localId: number,
  sgType: string,
): Promise<number | null> {
  const link = await findByLocal(ctx.connectionId, localType, localId);
  if (!link || link.sgType !== sgType) return null;
  return link.sgId;
}

/** The user's ShotGrid account, to write in their name when possible. */
async function actorLogin(ctx: PushContext, actorId: number | null | undefined): Promise<string | null> {
  if (!actorId || !ctx.settings.push.attributeToUser) return null;
  const link = await findByLocal(ctx.connectionId, 'user', actorId);
  const data = (link?.data ?? {}) as { login?: string };
  return data.login ?? null;
}

/** Matrix domain that governs each type of write. */
const JOB_DOMAIN: Record<PushJob['type'], 'tasks' | 'hierarchy' | 'versions' | 'notes' | 'playlists'> = {
  'task-create': 'tasks',
  'task-status': 'tasks',
  'task-dates': 'tasks',
  'task-assignee': 'tasks',
  'shot-status': 'hierarchy',
  'sequence-status': 'hierarchy',
  'asset-links': 'hierarchy',
  'asset-status': 'hierarchy',
  description: 'hierarchy',
  'version-status': 'versions',
  'version-publish': 'versions',
  comment: 'notes',
  playlist: 'playlists',
};

/**
 * Records a write refused by the rights matrix.
 *
 * Domain guards were bare `return`s: the job ended "ok" and nobody, anywhere, learned that the status had not gone out. The user saw their change taken into account
 * in ReView and then looked for why ShotGrid did not move. We aggregate per domain — a counter and a date are enough to surface the problem on the synchronization screen.
 */
async function noteBlockedPush(connectionId: number, job: PushJob, domain: string): Promise<void> {
  const connection = await prisma.shotgridConnection.findUnique({
    where: { id: connectionId },
    select: { pushBlocked: true },
  });
  const current = { ...((connection?.pushBlocked as Record<string, unknown> | null) ?? {}) };
  const entry = (current[domain] ?? {}) as { count?: number };
  current[domain] = { count: (entry.count ?? 0) + 1, at: new Date().toISOString(), jobType: job.type };
  await prisma.shotgridConnection.update({
    where: { id: connectionId },
    data: { pushBlocked: current as Prisma.InputJsonValue },
  });
  logger.info({ connectionId, domain, jobType: job.type }, 'Écriture ShotGrid refusée par les réglages');
}

export async function runPush(connectionId: number, job: PushJob): Promise<void> {
  const connection = await prisma.shotgridConnection.findUnique({
    where: { id: connectionId },
    include: { site: true },
  });
  if (!connection?.active) return;

  const client = clientForSiteRecord(connection.site);
  const ctx: PushContext = {
    connectionId,
    sgProjectId: connection.sgProjectId,
    sgProjectName: connection.sgProjectName,
    client,
    writer: writerFor({
      client,
      sgProjectId: connection.sgProjectId,
      sgProjectName: connection.sgProjectName,
    }),
    settings: parseSettings(connection.settings),
    baseUrl: connection.site.baseUrl,
  };

    // The refusal is detected here, once for all types: each write function re-tests its domain afterwards (defence in depth), but none could say so.
  const domain = JOB_DOMAIN[job.type];
  if (!can(ctx.settings, domain, 'write')) {
    await noteBlockedPush(connectionId, job, domain);
    return;
  }

  try {
    switch (job.type) {
      case 'task-create':
        await pushTaskCreateJob(ctx, job);
        break;
      case 'task-status':
        await pushTaskStatus(ctx, job);
        break;
      case 'task-dates':
        await pushTaskDates(ctx, job);
        break;
      case 'task-assignee':
        await pushTaskAssignee(ctx, job);
        break;
      case 'shot-status':
        await pushShotStatus(ctx, job);
        break;
      case 'sequence-status':
        await pushSequenceStatus(ctx, job);
        break;
      case 'version-status':
        await pushVersionStatus(ctx, job);
        break;
      case 'version-publish':
        await pushVersionPublish(ctx, job);
        break;
      case 'asset-links':
        await pushAssetLinks(ctx, job);
        break;
      case 'asset-status':
        await pushAssetStatus(ctx, job);
        break;
      case 'description':
        await pushDescription(ctx, job);
        break;
      case 'comment':
        await pushCommentJob(ctx, job);
        break;
      case 'playlist':
        await pushPlaylistJob(ctx, job);
        break;
    }
  } catch (err) {
    logger.error({ err, job }, 'Écriture ShotGrid en échec');
    throw err;
  }
}

/** ReView Task -> ShotGrid Task: the creation, and the link that attaches it. */
async function pushTaskCreateJob(ctx: PushContext, job: Extract<PushJob, { type: 'task-create' }>) {
  if (!can(ctx.settings, 'tasks', 'write')) return;
  await pushTaskCreation(
    {
      connectionId: ctx.connectionId,
      client: ctx.client,
      writer: ctx.writer,
      asUserLogin: await actorLogin(ctx, job.actorId),
    },
    job.taskId,
  );
}

async function pushTaskStatus(ctx: PushContext, job: Extract<PushJob, { type: 'task-status' }>) {
  if (!can(ctx.settings, 'tasks', 'write')) return;
  const task = await prisma.task.findUnique({
    where: { id: job.taskId },
    include: { pipelineStatus: true },
  });
  if (!task?.pipelineStatus) return;
  const sgId = await resolveTarget(ctx, 'task', task.id, 'Task');
  if (!sgId) return;

  const code = task.pipelineStatus.code;
  await ctx.writer.update(
    'Task',
    sgId,
    { sg_status_list: code },
    {
      asUserLogin: await actorLogin(ctx, job.actorId),
    },
  );
  logger.info({ taskId: task.id, sgId, code }, 'Statut de tâche poussé vers ShotGrid');
}

/**
 * Scheduling dates.
 *
 * ShotGrid links start_date, due_date and duration: changing one recalculates the others. Both dates therefore leave in the same request: sending them separately
 * would make a due date recalculate from a duration that no longer applies.
 */
async function pushTaskDates(ctx: PushContext, job: Extract<PushJob, { type: 'task-dates' }>) {
  if (!can(ctx.settings, 'tasks', 'write')) return;
  const task = await prisma.task.findUnique({ where: { id: job.taskId } });
  if (!task) return;
  const sgId = await resolveTarget(ctx, 'task', task.id, 'Task');
  if (!sgId) return;

  const payload: Record<string, unknown> = {};
  if (task.startDate) payload.start_date = toSgDate(task.startDate);
  if (task.dueDate) payload.due_date = toSgDate(task.dueDate);
  if (Object.keys(payload).length === 0) return;

  await ctx.writer.update('Task', sgId, payload, { asUserLogin: await actorLogin(ctx, job.actorId) });
}

async function pushTaskAssignee(ctx: PushContext, job: Extract<PushJob, { type: 'task-assignee' }>) {
  if (!can(ctx.settings, 'tasks', 'write')) return;
  const task = await prisma.task.findUnique({ where: { id: job.taskId } });
  if (!task) return;
  const sgId = await resolveTarget(ctx, 'task', task.id, 'Task');
  if (!sgId) return;

    // Assigning presupposes a matching ShotGrid account: without one, writing nothing is better than emptying the assignees list on the ShotGrid side.
  if (!task.assigneeId) return;
  const link = await findByLocal(ctx.connectionId, 'user', task.assigneeId);
  if (!link) {
    logger.info({ taskId: task.id }, 'Assignation non poussée : pas de compte ShotGrid correspondant');
    return;
  }
  await ctx.writer.update(
    'Task',
    sgId,
    {
      task_assignees: [{ id: link.sgId, type: 'HumanUser' }],
    },
    { asUserLogin: await actorLogin(ctx, job.actorId) },
  );
}

async function pushShotStatus(ctx: PushContext, job: Extract<PushJob, { type: 'shot-status' }>) {
  if (!can(ctx.settings, 'hierarchy', 'write')) return;
  const shot = await prisma.shot.findUnique({
    where: { id: job.shotId },
    include: { pipelineStatus: true },
  });
  if (!shot?.pipelineStatus) return;
  const sgId = await resolveTarget(ctx, 'shot', shot.id, 'Shot');
  if (!sgId) return;

  const code = shot.pipelineStatus.code;
  await ctx.writer.update(
    'Shot',
    sgId,
    { sg_status_list: code },
    {
      asUserLogin: await actorLogin(ctx, job.actorId),
    },
  );
}

/**
 * ReView sequence status -> ShotGrid.
 *
 * No path existed: a sequence has carried a status since phase 48, but no job type carried it to the site. The studio changed the state of a sequence in ReView and the
 * site knew nothing — until the next synchronization brought the old value back.
 */
async function pushSequenceStatus(ctx: PushContext, job: Extract<PushJob, { type: 'sequence-status' }>) {
  if (!can(ctx.settings, 'hierarchy', 'write')) return;
  const sequence = await prisma.sequence.findUnique({
    where: { id: job.sequenceId },
    include: { pipelineStatus: true },
  });
  if (!sequence?.pipelineStatus) return;
  const sgId = await resolveTarget(ctx, 'sequence', sequence.id, 'Sequence');
  if (!sgId) return;

  const code = sequence.pipelineStatus.code;
  await ctx.writer.update(
    'Sequence',
    sgId,
    { sg_status_list: code },
    { asUserLogin: await actorLogin(ctx, job.actorId) },
  );
  logger.info({ sequenceId: sequence.id, sgId, code }, 'Statut de séquence poussé vers ShotGrid');
}

/**
 * ReView asset status -> ShotGrid.
 *
 * The asset had no status of its own: it borrowed the vocabulary of tasks, and nothing therefore went up to the site. The path is that of the shot and the sequence,
 * down to the entity.
 */
async function pushAssetStatus(ctx: PushContext, job: Extract<PushJob, { type: 'asset-status' }>) {
  if (!can(ctx.settings, 'hierarchy', 'write')) return;
  const asset = await prisma.asset.findUnique({
    where: { id: job.assetId },
    include: { pipelineStatus: true },
  });
  if (!asset?.pipelineStatus) return;
  const sgId = await resolveTarget(ctx, 'asset', asset.id, 'Asset');
  if (!sgId) return;

  await ctx.writer.update(
    'Asset',
    sgId,
    { sg_status_list: asset.pipelineStatus.code },
    { asUserLogin: await actorLogin(ctx, job.actorId) },
  );
}

/**
 * ReView description -> ShotGrid, when the studio has opened the round trip.
 *
 * Two locks, and both are needed: the `hierarchy` domain must be open for writing (the general setting), and `descriptions.writeBack` must be too (the precise setting).
 * The first alone is not enough: a studio may want to send back statuses without sending back briefs, which its production writes on the site side.
 *
 * A description emptied in ReView is sent as an empty string, not ignored: erasing is a modification like any other, and sending nothing would leave the site showing a
 * text that ReView no longer displays.
 */
async function pushDescription(ctx: PushContext, job: Extract<PushJob, { type: 'description' }>) {
  if (!can(ctx.settings, 'hierarchy', 'write')) return;
  if (!ctx.settings.descriptions.writeBack) return;

  const description = await readDescription(job.kind, job.id);
  if (description === undefined) return;
  const sgType = job.kind === 'sequence' ? 'Sequence' : job.kind === 'shot' ? 'Shot' : 'Asset';
  const sgId = await resolveTarget(ctx, job.kind, job.id, sgType);
  if (!sgId) return;

  await ctx.writer.update(
    sgType,
    sgId,
    { description: description ?? '' },
    { asUserLogin: await actorLogin(ctx, job.actorId) },
  );
  logger.info({ kind: job.kind, id: job.id, sgId }, 'Description poussée vers ShotGrid');
}

/** The local description, or `undefined` when the entity no longer exists. */
async function readDescription(
  kind: 'sequence' | 'shot' | 'asset',
  id: number,
): Promise<string | null | undefined> {
  const select = { description: true };
  const row =
    kind === 'sequence'
      ? await prisma.sequence.findUnique({ where: { id }, select })
      : kind === 'shot'
        ? await prisma.shot.findUnique({ where: { id }, select })
        : await prisma.asset.findUnique({ where: { id }, select });
  return row?.description;
}

/** ReView review decision -> status of the ShotGrid Version. */
async function pushVersionStatus(ctx: PushContext, job: Extract<PushJob, { type: 'version-status' }>) {
  if (!can(ctx.settings, 'versions', 'write')) return;
  const version = await prisma.version.findUnique({ where: { id: job.versionId } });
  if (!version?.reviewStatusId) return;
  const sgId = await resolveTarget(ctx, 'version', version.id, 'Version');
  if (!sgId) return;

    // The configured map first; failing that, a deduction by name, read-only.
    // Without this second path, closing the read of the status reference was enough to cut every sending of review decisions.
  const code =
    inverseVersionStatusMap(ctx.settings.versionStatusMap).get(version.reviewStatusId) ??
    (await resolveVersionStatusCode(ctx.client, version.reviewStatusId));
  if (!code) {
    logger.info(
      { versionId: version.id, reviewStatusId: version.reviewStatusId },
      'Décision non poussée : statut ReView sans correspondance ShotGrid',
    );
    return;
  }
  await ctx.writer.update(
    'Version',
    sgId,
    { sg_status_list: code },
    {
      asUserLogin: await actorLogin(ctx, job.actorId),
    },
  );
  logger.info({ versionId: version.id, sgId, code }, 'Décision de review poussée vers ShotGrid');
}

/**
 * ReView publication -> ShotGrid Version.
 *
 * Two modes set per project: the link (the ShotGrid Version points back to the ReView review, without duplicating the media) or the sending of the file. The link is the
 * default: duplicating dailies masters is costly, and ReView remains the place of the review.
 */
async function pushVersionPublish(ctx: PushContext, job: Extract<PushJob, { type: 'version-publish' }>) {
  if (!can(ctx.settings, 'versions', 'write')) return;
  if (ctx.settings.push.publishMode === 'off') return;

  const version = await prisma.version.findUnique({
    where: { id: job.versionId },
    include: {
      task: { include: { shot: true, asset: true } },
      asset: true,
      media: { where: { deletedAt: null }, orderBy: { id: 'asc' }, take: 1 },
    },
  });
  if (!version) return;

  const already = await findByLocal(ctx.connectionId, 'version', version.id);
  if (already) {
        // The version already exists over there: adding a media to a version in progress must enrich THAT version, not manufacture a second one bearing the same name.
    const media = version.media[0];
    if (media) {
      await uploadThumbnail(ctx, already.sgId, media);
      if (ctx.settings.push.publishMode === 'upload') {
        await uploadMasterMedia(ctx, already.sgId, media);
      }
      logger.info(
        { versionId: version.id, sgId: already.sgId },
        'Média ajouté à la version ShotGrid existante',
      );
    }
    return;
  }

    /**
     * A Version of the same code may already exist there — created by the artist's render tool before they published here. Attaching to it rather than making a twin:
     * the site has no way to tell two identical entries apart, and the duplicate is deleted by hand.
     */
  const twin = await findVersionByCode(
    { client: ctx.client, scope: { sgProjectId: ctx.sgProjectId, sgProjectName: ctx.sgProjectName } },
    version.name,
  );
  if (twin) {
    await upsertLink({
      connectionId: ctx.connectionId,
      localType: 'version',
      localId: version.id,
      sgType: 'Version',
      sgId: twin,
            // `mediaImported`: without it, the next synchronization would fetch back the media we have just sent, as a duplicate.
      data: { publishMode: ctx.settings.push.publishMode, mediaImported: true },
    });
    const media = version.media[0];
    if (media) {
      await uploadThumbnail(ctx, twin, media);
      if (ctx.settings.push.publishMode === 'upload') await uploadMasterMedia(ctx, twin, media);
    }
    logger.info({ versionId: version.id, sgId: twin }, 'Version ShotGrid homonyme réutilisée');
    return;
  }

  const payload: Record<string, unknown> = {
    project: { type: 'Project', id: ctx.sgProjectId },
    code: version.name,
    description: [version.task?.name, 'Publié depuis ReView'].filter(Boolean).join(' — '),
  };

  if (version.taskId) {
    const taskLink = await findByLocal(ctx.connectionId, 'task', version.taskId);
    if (taskLink) payload.sg_task = { type: 'Task', id: taskLink.sgId };
  }
  const shotId = version.task?.shotId ?? null;
  const assetId = version.assetId ?? version.task?.assetId ?? null;
  if (shotId) {
    const link = await findByLocal(ctx.connectionId, 'shot', shotId);
    if (link) payload.entity = { type: 'Shot', id: link.sgId };
  } else if (assetId) {
    const link = await findByLocal(ctx.connectionId, 'asset', assetId);
    if (link) payload.entity = { type: 'Asset', id: link.sgId };
  }

  const reviewUrl = env.APP_URL
    ? `${env.APP_URL.replace(/\/$/, '')}/review/${version.media[0]?.id ?? ''}`
    : null;
  if (reviewUrl) payload.sg_path_to_movie = reviewUrl;

  const created = await ctx.writer.create('Version', payload, {
    asUserLogin: await actorLogin(ctx, job.actorId),
  });
  await upsertLink({
    connectionId: ctx.connectionId,
    localType: 'version',
    localId: version.id,
    sgType: 'Version',
    sgId: created.id,
    data: {
      createdFromReview: true,
      publishMode: ctx.settings.push.publishMode,
            // This version's media is the one we have just sent: it is already here. Without this marker, the next synchronization would download it again from the site
            // and add it to the same version — one more copy at every pass.
      mediaImported: true,
    },
  });
  logger.info(
    { versionId: version.id, sgId: created.id, mode: ctx.settings.push.publishMode },
    'Version créée dans ShotGrid depuis une publication ReView',
  );

    // Thumbnail first: light, it is enough to make the version recognizable in ShotGrid lists even when the file itself stays with us.
  const media = version.media[0];
  if (media) {
    await uploadThumbnail(ctx, created.id, media);
    if (ctx.settings.push.publishMode === 'upload') {
      await uploadMasterMedia(ctx, created.id, media);
    }
  }
}

/** ReView dailies playlist -> ShotGrid Playlist, order included. */
async function pushPlaylistJob(ctx: PushContext, job: Extract<PushJob, { type: 'playlist' }>) {
  if (!can(ctx.settings, 'playlists', 'write')) return;
  await pushPlaylist(
    {
      connectionId: ctx.connectionId,
      sgProjectId: ctx.sgProjectId,
            // The scope expects a project name; the caller has it at hand. Pass it rather than let the `?? ''` fallback settle in: `belongsToProject` only rules
            // on the identifier today, but a scope half of which is an empty string is a trap for whoever extends it to the name.
      sgProjectName: ctx.sgProjectName,
      client: ctx.client,
      writer: ctx.writer,
      asUserLogin: await actorLogin(ctx, job.actorId),
    },
    job.playlistId,
  );
}

/** ReView comment -> ShotGrid note, with the annotated frame attached. */
async function pushCommentJob(ctx: PushContext, job: Extract<PushJob, { type: 'comment' }>) {
  if (!can(ctx.settings, 'notes', 'write')) return;
  await pushComment(
    {
      connectionId: ctx.connectionId,
      sgProjectId: ctx.sgProjectId,
      writer: ctx.writer,
      attachAnnotations: ctx.settings.push.attachAnnotations,
      asUserLogin: await actorLogin(ctx, job.actorId),
    },
    job.commentId,
  );
}

/**
 * An asset's links to shots and sequences.
 *
 * ShotGrid holds these links on the asset itself (`shots`, `sequences`): that is where the "which assets for this shot" lists come from. Assigning in ReView without
 * reflecting them left production blind on the ShotGrid side, even though the information existed on both sides.
 */
async function pushAssetLinks(ctx: PushContext, job: Extract<PushJob, { type: 'asset-links' }>) {
  if (!can(ctx.settings, 'hierarchy', 'write')) return;
  const asset = await prisma.asset.findUnique({
    where: { id: job.assetId },
    include: {
      shots: { where: { deletedAt: null }, select: { id: true } },
      sequences: { where: { deletedAt: null }, select: { id: true } },
    },
  });
  if (!asset) return;
  const sgId = await resolveTarget(ctx, 'asset', asset.id, 'Asset');
  if (!sgId) return;

    // Only the links whose counterpart exists on the ShotGrid side are sent: a shot created locally and never synchronized has no remote identifier to cite.
  const shotRefs: Array<{ type: string; id: number }> = [];
  for (const shot of asset.shots) {
    const link = await findByLocal(ctx.connectionId, 'shot', shot.id);
    if (link) shotRefs.push({ type: 'Shot', id: link.sgId });
  }
  const sequenceRefs: Array<{ type: string; id: number }> = [];
  for (const sequence of asset.sequences) {
    const link = await findByLocal(ctx.connectionId, 'sequence', sequence.id);
    if (link) sequenceRefs.push({ type: 'Sequence', id: link.sgId });
  }

  await ctx.writer.update(
    'Asset',
    sgId,
    { shots: shotRefs, sequences: sequenceRefs },
    { asUserLogin: await actorLogin(ctx, job.actorId) },
  );
  logger.info(
    { assetId: asset.id, sgId, shots: shotRefs.length, sequences: sequenceRefs.length },
    'Rattachements d’asset poussés vers ShotGrid',
  );
}

/** Thumbnail of the version, sent in the `image` field of ShotGrid. */
async function uploadThumbnail(
  ctx: PushContext,
  sgVersionId: number,
  media: { id: number; thumbnailKey: string | null },
): Promise<void> {
  if (!media.thumbnailKey) return;
  try {
    const buffer = await storage.getObjectBuffer(media.thumbnailKey);
    await ctx.writer.upload('Version', sgVersionId, 'image', buffer, `thumb-${media.id}.webp`, 'image/webp');
  } catch (err) {
    logger.warn({ err, mediaId: media.id }, 'Vignette non transmise à ShotGrid');
  }
}

/**
 * Transfer of the file itself to `sg_uploaded_movie`, which triggers ShotGrid's transcoding. Reserved for "upload" mode: a dailies master weighs a lot, and duplicating it
 * only makes sense if the studio wants ShotGrid to be self-sufficient.
 */
async function uploadMasterMedia(
  ctx: PushContext,
  sgVersionId: number,
  media: {
    id: number;
    storageKey: string;
    originalName: string;
    mimeType: string;
    size: bigint;
    metadata: unknown;
  },
): Promise<void> {
  const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
  if (Number(media.size) > MAX_UPLOAD_BYTES) {
    logger.warn(
      { mediaId: media.id, size: Number(media.size) },
      'Média trop volumineux pour un envoi vers ShotGrid — la version reste liée sans fichier',
    );
    return;
  }
  try {
    const buffer = await storage.getObjectBuffer(mediaSourceKey(media));
        // `sg_uploaded_movie` accepts images and videos: it is what triggers ShotGrid's transcoding and feeds its player.
    await ctx.writer.upload(
      'Version',
      sgVersionId,
      'sg_uploaded_movie',
      buffer,
      media.originalName,
      media.mimeType,
    );
    logger.info({ mediaId: media.id, sgVersionId }, 'Média envoyé vers ShotGrid');
  } catch (err) {
    logger.error({ err, mediaId: media.id }, 'Envoi du média vers ShotGrid en échec');
  }
}
