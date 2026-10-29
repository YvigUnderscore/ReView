// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWriteStream, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { MediaKind, MediaStatus, TaskType, VersionStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { resolveStorageContextForVersion } from '../../lib/pipeline';
import { storage, StorageService } from '../StorageService';
import { enqueueMediaJob } from '../JobService';
import { belongsToProject, projectFilter } from './shotgridProjectGuard';
import {
  asDate,
  asEntityRef,
  asNumber,
  asString,
  pickVersionMediaField,
  attachmentId,
  attachmentName,
  attachmentUrl,
  type SgRecord,
} from './shotgridMapper';
import {
  mapSgToLocal,
  removeLink,
  shouldImportMedia,
  upsertLink,
  type VersionLinkData,
} from './shotgridLinks';
import { softDeleteVersion } from '../../lib/trash';
import { can } from './shotgridSettings';
import { sgMediaName } from '../../lib/mediaNaming';
import { realignMediaNames } from './ShotgridMediaNaming';
import { confirmGone, noteUnknownStatus, touch, type PullContext } from './ShotgridPullService';

/**
 * Import of Media Publishes: a ShotGrid Version becomes a ReView Version with its media, ready to be annotated frame by frame.
 *
 * The media is streamed to MinIO then handed to the usual pipeline (HLS transcoding, thumbnails): a publish coming from ShotGrid then behaves exactly like a manual upload.
 * It is born published — a ShotGrid Version IS a publication, keeping it as a draft would make no sense.
 */

const VERSION_FIELDS = [
  'code',
  'description',
  'entity',
  'sg_task',
  'sg_status_list',
  'user',
  'sg_first_frame',
  'sg_last_frame',
  'sg_path_to_movie',
  'sg_uploaded_movie',
  'sg_uploaded_movie_mp4',
  'sg_uploaded_movie_webm',
  'project',
  'updated_at',
  'created_at',
];

/** A shot's catch-all task: receives the publishes without an explicit ShotGrid task. */
const IMPORT_TASK_NAME = 'ShotGrid';

export interface ImportVersionsOptions {
  since?: Date | null;
  /** Specific versions to import (manual selection from the tab). */
  onlySgIds?: number[];
  /** Import of the media file (disabled for a simple inventory). */
  withMedia?: boolean;
}

export async function pullVersions(ctx: PullContext, options: ImportVersionsOptions = {}): Promise<void> {
  if (!can(ctx.settings, 'versions', 'read')) return;

  const filters: Array<[string, string, unknown]> = [projectFilter(ctx.scope.sgProjectId)];
  if (options.since) filters.push(['updated_at', 'greater_than', options.since.toISOString()]);
  if (options.onlySgIds?.length) filters.push(['id', 'in', options.onlySgIds]);

  const records = await ctx.client.search('Version', { fields: VERSION_FIELDS, filters, sort: 'id' });
  const statusFilter = ctx.settings.media.statusFilter;
  // A single read of the link table for the whole batch: it serves to distinguish the version already known (which we update) from the new version (which the filter may discard).
  const knownVersions = await mapSgToLocal(ctx.connection.id, 'version');

  /**
   * Versions removed from the site.
   *
   * Only on a targeted request — that is, a removal event, which names the deleted version. A version absent from an incremental batch has not been deleted, it has
   * not changed; and a complete sweep is not entrusted with this power here, since it would put in the trash, all at once and without anyone having asked, everything
   * deleted from the site since the connection was put into service.
   */
  if (options.onlySgIds?.length) {
    // `confirmGone` distinguishes "the site no longer has it" from "the project guard discarded it": only the first is a removal.
    const alive = new Set(records.map((r) => r.id));
    const gone = await confirmGone(ctx, 'Version', options.onlySgIds, alive);
    await trashRemovedVersions(ctx, gone, knownVersions);
  }

  for (const record of records) {
    const verdict = belongsToProject(record, ctx.scope);
    if (!verdict.ok) {
      ctx.journal.count('guard', 'skipped');
      await ctx.journal.log(
        'error',
        'shotgrid.log.wrongProject',
        {
          sgType: 'Version',
          sgId: record.id,
          expected: ctx.scope.sgProjectId,
          found: verdict.foundProjectId,
        },
        { sgType: 'Version', sgId: record.id },
      );
      continue;
    }

    const statusCode = asString(record.sg_status_list);
    /**
     * The status filter decides what we **import**, not what we **follow**.
     *
     * It applied to everyone: an already imported version whose status moved outside the filter (for example from "in review" to "approved") was purely skipped, and
     * its review status stayed frozen forever on the ReView side. Yet it is already there — it is precisely the version whose status we want to see advance.
     *
     * A manual selection (`onlySgIds`) overrides it: it is an explicit decision.
     */
    const alreadyImported = knownVersions.has(record.id);
    if (
      !alreadyImported &&
      !options.onlySgIds?.length &&
      statusFilter.length > 0 &&
      statusCode &&
      !statusFilter.includes(statusCode)
    ) {
      ctx.journal.count('versions', 'skipped');
      continue;
    }

    try {
      // Known version but outside the filter: we refresh its metadata and its status, without fetching any media — the filter keeps all its meaning on that point.
      const withMedia =
        options.withMedia !== false &&
        (!alreadyImported || statusFilter.length === 0 || !statusCode || statusFilter.includes(statusCode));
      await importVersion(ctx, record, withMedia);
    } catch (err) {
      ctx.journal.count('versions', 'failed');
      await ctx.journal.log(
        'error',
        'shotgrid.log.versionImportFailed',
        {
          name: asString(record.code) ?? String(record.id),
          error: err instanceof Error ? err.message : String(err),
        },
        { sgType: 'Version', sgId: record.id },
      );
    }
  }
}

/**
 * Versions deleted from the site -> ReView's trash.
 *
 * A removed version no longer comes back from any search: the requested identifier missing from the response is the only trace of its disappearance. It is the trash and
 * not a deletion, as for shots and sequences — the media, the comments and the review decision remain viewable, and a removal made by mistake in ShotGrid is repaired without losing anything.
 *
 * The link survives the trashing: restoring the version on the site side must bring back the one here as it was, not manufacture a copy.
 */
async function trashRemovedVersions(
  ctx: PullContext,
  goneSgIds: readonly number[],
  links: Map<number, { localId: number }>,
): Promise<void> {
  for (const sgId of goneSgIds) {
    const link = links.get(sgId);
    if (!link) continue;

    const version = await prisma.version.findUnique({ where: { id: link.localId } });
    // Target already gone: the link no longer designates anything, and keeping it would replay this removal at every pass.
    if (!version) {
      await removeLink(ctx.connection.id, 'Version', sgId);
      continue;
    }
    if (version.deletedAt) continue;

    await softDeleteVersion(version.id);
    ctx.journal.count('versions', 'skipped');
    await ctx.journal.log(
      'info',
      'shotgrid.log.trashedRemotely',
      { sgType: 'Version', sgId },
      { sgType: 'Version', sgId, localType: 'version', localId: version.id },
    );
    touch(ctx, 'version', version.id, { taskId: version.taskId, assetId: version.assetId });
  }
}

/**
 * Attachment of a ShotGrid Version in the ReView tree.
 *
 * ShotGrid allows a Version without a task, attached directly to the shot. ReView files versions under a task or an asset: rather than discarding these publishes,
 * we open a dedicated task per shot for them, visible and identifiable.
 */
async function resolveParent(
  ctx: PullContext,
  record: SgRecord,
): Promise<{ taskId: number | null; assetId: number | null } | null> {
  const taskRef = asEntityRef(record.sg_task);
  if (taskRef) {
    const link = await prisma.shotgridLink.findUnique({
      where: {
        connectionId_sgType_sgId: { connectionId: ctx.connection.id, sgType: 'Task', sgId: taskRef.id },
      },
    });
    if (link) return { taskId: link.localId, assetId: null };
  }

  const entityRef = asEntityRef(record.entity);
  if (!entityRef) return null;

  if (entityRef.type === 'Asset') {
    const link = await prisma.shotgridLink.findUnique({
      where: {
        connectionId_sgType_sgId: { connectionId: ctx.connection.id, sgType: 'Asset', sgId: entityRef.id },
      },
    });
    return link ? { taskId: null, assetId: link.localId } : null;
  }

  if (entityRef.type === 'Shot') {
    const shotLink = await prisma.shotgridLink.findUnique({
      where: {
        connectionId_sgType_sgId: { connectionId: ctx.connection.id, sgType: 'Shot', sgId: entityRef.id },
      },
    });
    if (!shotLink) return null;
    const existing = await prisma.task.findFirst({
      where: { shotId: shotLink.localId, name: IMPORT_TASK_NAME },
    });
    if (existing) return { taskId: existing.id, assetId: null };
    const created = await prisma.task.create({
      data: { name: IMPORT_TASK_NAME, type: TaskType.OTHER, shotId: shotLink.localId, order: 999 },
    });
    await ctx.journal.log(
      'info',
      'shotgrid.log.importTaskCreated',
      { shot: entityRef.name ?? String(entityRef.id) },
      { localType: 'task', localId: created.id },
    );
    return { taskId: created.id, assetId: null };
  }
  return null;
}

export async function importVersion(ctx: PullContext, record: SgRecord, withMedia: boolean): Promise<void> {
  const name = asString(record.code) ?? `V${record.id}`;
  const parent = await resolveParent(ctx, record);
  if (!parent) {
    ctx.journal.count('versions', 'skipped');
    await ctx.journal.log(
      'warn',
      'shotgrid.log.versionWithoutParent',
      { name },
      { sgType: 'Version', sgId: record.id },
    );
    return;
  }

  const statusCode = asString(record.sg_status_list);
  /**
   * Review status: ReView is authoritative outside an explicit match.
   *
   * `reviewStatusId` used to be written unconditionally — `null` as soon as a code was not in `versionStatusMap`, a map often empty or partial. Each pass therefore erased the
   * human decision (approved, retake) taken in ReView, without conflict or trace. It is the datum whose overwriting costs the most of the whole integration.
   *
   * We therefore write only if the studio has explicitly translated the code. A version with no status on the site side says nothing about the review decision: it does not erase it.
   */
  const mapped = statusCode ? ctx.settings.versionStatusMap[statusCode] : undefined;
  const reviewPatch = mapped ? { reviewStatusId: mapped } : {};
  if (statusCode && !mapped) await noteUnknownStatus(ctx, 'version', statusCode, name);
  const authorRef = asEntityRef(record.user);
  const authorLink = authorRef
    ? await prisma.shotgridLink.findUnique({
        where: {
          connectionId_sgType_sgId: {
            connectionId: ctx.connection.id,
            sgType: 'HumanUser',
            sgId: authorRef.id,
          },
        },
      })
    : null;

  const links = await mapSgToLocal(ctx.connection.id, 'version');
  const existingLink = links.get(record.id);
  const existing = existingLink
    ? await prisma.version.findUnique({ where: { id: existingLink.localId } })
    : null;

  const data = {
    name,
    taskId: parent.taskId,
    assetId: parent.assetId,
    authorId: authorLink?.localId ?? null,
    status: VersionStatus.PUBLISHED,
    published: true,
    ...reviewPatch,
    deletedAt: null,
  };

  const version = existing
    ? await prisma.version.update({ where: { id: existing.id }, data })
    : await prisma.version.create({ data });
  ctx.journal.count('versions', existing ? 'updated' : 'created');
  // Same reason as for the hierarchy: the open review must see the version and its decision arrive without being asked to reload.
  // Re-alignment of media imported before the names were aligned: idempotent, and without
  // migration — the version's code is only known here.
  await realignMediaNames(ctx, version.id, name);
  // Goes through the collector: a complete pass aligned twelve thousand versions, hence twelve thousand emissions. `touch` emits at once when nobody accumulates.
  touch(ctx, 'version', version.id, { taskId: version.taskId, assetId: version.assetId });

  const previous = existingLink?.data as VersionLinkData | undefined;
  const linkData: VersionLinkData = {
    sgStatusCode: statusCode,
    sgPathToMovie: asString(record.sg_path_to_movie),
    sgFirstFrame: asNumber(record.sg_first_frame),
    sgLastFrame: asNumber(record.sg_last_frame),
    mediaImported: Boolean(previous?.mediaImported),
    // The origin is not rediscovered: `upsertLink` replaces `data`, and forgetting it here would make a version born in ReView pass for a site version at the next
    // pass — with its media fetched back in duplicate.
    ...(previous?.createdFromReview ? { createdFromReview: true } : {}),
  };

  /**
   * The link is set BEFORE any attempt on the media, and this is essential: it says "this ShotGrid Version is already in ReView", which is true from now on. Setting the link
   * after the transfer left the version orphaned at the slightest download failure — and the next synchronization, finding nothing, would recreate one. One per pass, indefinitely.
   */
  await upsertLink({
    connectionId: ctx.connection.id,
    localType: 'version',
    localId: version.id,
    sgType: 'Version',
    sgId: record.id,
    sgUpdatedAt: asDate(record.updated_at),
    data: linkData,
  });

  // The media is an add-on: its failure invalidates neither the version nor its status.
  if (shouldImportMedia({ withMedia, autoImport: ctx.settings.media.autoImport, link: linkData })) {
    try {
      if (await importVersionMedia(ctx, record, version.id, name)) {
        await upsertLink({
          connectionId: ctx.connection.id,
          localType: 'version',
          localId: version.id,
          sgType: 'Version',
          sgId: record.id,
          sgUpdatedAt: asDate(record.updated_at),
          data: { ...linkData, mediaImported: true },
        });
      }
    } catch (err) {
      ctx.journal.count('media', 'failed');
      await ctx.journal.log(
        'warn',
        'shotgrid.log.mediaImportFailed',
        { name, error: err instanceof Error ? err.message : String(err) },
        { sgType: 'Version', sgId: record.id, localType: 'version', localId: version.id },
      );
    }
  }
}

/**
 * Transfer of the media file.
 *
 * ShotGrid delivers a signed S3 URL with a very short lifetime: it is consumed immediately, streamed to MinIO. A dailies master weighs several gigabytes —
 * loading it into memory would bring the worker down.
 */
export async function importVersionMedia(
  ctx: PullContext,
  record: SgRecord,
  versionId: number,
  versionName: string,
): Promise<boolean> {
  const picked = pickVersionMediaField(record, ctx.settings.media.source);
  if (!picked) {
    await ctx.journal.log(
      'info',
      'shotgrid.log.versionWithoutMedia',
      { name: versionName },
      { sgType: 'Version', sgId: record.id },
    );
    return false;
  }

  // The dedicated endpoint first, the address carried by the field next: depending on the site and the field, one or the other answers.
  const url =
    (await ctx.client.downloadUrl('Version', record.id, picked.field)) ?? attachmentUrl(picked.value);
  if (!url) {
    await ctx.journal.log(
      'warn',
      'shotgrid.log.mediaUrlUnavailable',
      { name: versionName, field: picked.field },
      { sgType: 'Version', sgId: record.id },
    );
    return false;
  }

  const sourceFilename = attachmentName(picked.value, `${versionName}.mp4`);
  const { stream, size, type } = await ctx.client.openStream(url);

  const maxBytes = ctx.settings.media.maxSizeMo ? ctx.settings.media.maxSizeMo * 1024 * 1024 : null;
  if (maxBytes && size && size > maxBytes) {
    stream.destroy();
    ctx.journal.count('media', 'skipped');
    await ctx.journal.log(
      'warn',
      'shotgrid.log.mediaTooLarge',
      { name: versionName, sizeMo: Math.round(size / 1024 / 1024), limitMo: ctx.settings.media.maxSizeMo },
      { sgType: 'Version', sgId: record.id },
    );
    return false;
  }

  const storageCtx = await resolveStorageContextForVersion(versionId);
  if (!storageCtx) {
    stream.destroy();
    return false;
  }

  const contentType = type ?? 'video/mp4';
  // The media carries the Version's code, not the attached file's name: it is that name which the production reads in its playlists and says during dailies.
  const filename =
    ctx.settings.media.naming === 'filename'
      ? sourceFilename
      : sgMediaName({ code: versionName, sourceFilename, mimeType: contentType });
  const media = await prisma.mediaObject.create({
    data: {
      versionId,
      kind: kindFromContentType(contentType, filename),
      originalName: filename,
      storageKey: '',
      mimeType: contentType,
      status: MediaStatus.UPLOADING,
      published: true,
      metadata: {
        importedFromShotgrid: true,
        sgVersionId: record.id,
        sgField: picked.field,
        // The real name of the file stays readable in the technical sheet: a studio's naming convention often carries information that the code does not reproduce.
        sourceFilename,
      },
    },
  });
  const storageKey = StorageService.mediaKey({
    projectSlug: storageCtx.projectSlug,
    parentSegment: storageCtx.parentSegment,
    versionName: storageCtx.versionName,
    mediaId: media.id,
    filename: filename.replace(/[^\w.-]+/g, '_'),
  });

  // Going through a temporary file rather than a direct streaming of the network flow: object storage requires the size of the content in advance, which ShotGrid
  // does not guarantee in its responses. The disk also avoids holding a master in memory.
  const tmpPath = join(tmpdir(), `sg-${media.id}-${Date.now()}`);
  let bytes: number | undefined;
  try {
    await pipeline(stream, createWriteStream(tmpPath));
    bytes = statSync(tmpPath).size;
    if (maxBytes && bytes > maxBytes) {
      ctx.journal.count('media', 'skipped');
      await ctx.journal.log(
        'warn',
        'shotgrid.log.mediaTooLarge',
        { name: versionName, sizeMo: Math.round(bytes / 1024 / 1024), limitMo: ctx.settings.media.maxSizeMo },
        { sgType: 'Version', sgId: record.id },
      );
      await prisma.mediaObject.delete({ where: { id: media.id } });
      return false;
    }
    await storage.uploadFile(storageKey, tmpPath, contentType);
  } finally {
    rmSync(tmpPath, { force: true });
  }

  const uploaded = await prisma.mediaObject.update({
    where: { id: media.id },
    data: { storageKey, size: BigInt(bytes || size || 0), status: MediaStatus.PROCESSING },
  });

  /**
   * The media's link — set only if the site names its `Attachment`.
   *
   * It carried `sgType: 'Attachment'` with the identifier of the **Version**: the type and the identifier spoke of two different entities. The link was wrong, and harmful:
   * `upsertLink` removing any conflict, a real `Attachment` that happened to carry the same number as a Version saw its link erased in favour of the liar.
   *
   * The file is described by the `Attachment` that the field exposes; its identifier is authoritative. When the site returns none (some fields deliver only a URL), we write no link:
   * the media stays traceable through its metadata (`sgVersionId`, `sgField`), which are, for their part, what they say.
   */
  const sgAttachmentId = attachmentId(picked.value);
  if (sgAttachmentId !== null) {
    await upsertLink({
      connectionId: ctx.connection.id,
      localType: 'media',
      localId: uploaded.id,
      sgType: 'Attachment',
      sgId: sgAttachmentId,
      data: { field: picked.field, filename, sgVersionId: record.id },
    });
  } else {
    logger.debug(
      { mediaId: uploaded.id, sgVersionId: record.id, field: picked.field },
      'Attachment ShotGrid sans identifiant — média importé sans correspondance',
    );
  }

  const jobKind = uploaded.kind === MediaKind.VIDEO ? 'transcode' : 'thumbnail';
  await enqueueMediaJob({ mediaObjectId: uploaded.id, kind: jobKind });
  ctx.journal.count('media', 'created');
  logger.info({ mediaId: uploaded.id, sgVersionId: record.id, storageKey }, 'Média ShotGrid importé');
  return true;
}

function kindFromContentType(contentType: string, filename: string): MediaKind {
  const lower = `${contentType} ${filename}`.toLowerCase();
  if (lower.includes('video') || /\.(mov|mp4|mkv|webm|avi)$/.test(lower)) return MediaKind.VIDEO;
  if (lower.includes('image') || /\.(jpg|jpeg|png|exr|tif|tiff|webp)$/.test(lower)) return MediaKind.IMAGE;
  return MediaKind.VIDEO;
}

/**
 * Pipeline publishes (`PublishedFile`): paths of the working files.
 * Kept as metadata on the version — ReView does not mount the studio's storage, but displaying the path saves a round trip to ShotGrid.
 */
export async function pullPublishedFiles(ctx: PullContext): Promise<void> {
  if (!can(ctx.settings, 'versions', 'read')) return;
  const records = await ctx.client.search('PublishedFile', {
    fields: ['code', 'path', 'version_number', 'entity', 'task', 'version', 'published_file_type', 'project'],
    filters: [projectFilter(ctx.scope.sgProjectId)],
    maxRecords: 5000,
  });

  const byVersion = new Map<number, VersionLinkData['publishedFiles']>();
  for (const record of records) {
    if (!belongsToProject(record, ctx.scope).ok) continue;
    const versionRef = asEntityRef(record.version);
    if (!versionRef) continue;
    const path = record.path as { local_path?: string; name?: string } | null;
    const entry = {
      id: record.id,
      name: asString(record.code) ?? `#${record.id}`,
      path: path?.local_path ?? null,
      type: asEntityRef(record.published_file_type)?.name ?? null,
      version: asNumber(record.version_number),
    };
    const list = byVersion.get(versionRef.id) ?? [];
    list.push(entry);
    byVersion.set(versionRef.id, list);
  }

  for (const [sgVersionId, files] of byVersion) {
    const link = await prisma.shotgridLink.findUnique({
      where: {
        connectionId_sgType_sgId: { connectionId: ctx.connection.id, sgType: 'Version', sgId: sgVersionId },
      },
    });
    if (!link) continue;
    await upsertLink({
      connectionId: ctx.connection.id,
      localType: 'version',
      localId: link.localId,
      sgType: 'Version',
      sgId: sgVersionId,
      sgUpdatedAt: link.sgUpdatedAt,
      data: { ...(link.data as VersionLinkData), publishedFiles: files },
    });
    ctx.journal.count('publishedFiles', 'updated');
  }
}

/** ShotGrid Versions not yet imported — feeds the manual selection table. */
export async function listImportableVersions(ctx: PullContext) {
  const records = await ctx.client.search('Version', {
    fields: VERSION_FIELDS,
    filters: [projectFilter(ctx.scope.sgProjectId)],
    sort: '-id',
    maxRecords: 500,
  });
  const links = await mapSgToLocal(ctx.connection.id, 'version');
  return records
    .filter((r) => belongsToProject(r, ctx.scope).ok)
    .map((r) => ({
      sgId: r.id,
      code: asString(r.code) ?? `#${r.id}`,
      status: asString(r.sg_status_list),
      description: asString(r.description),
      entity: asEntityRef(r.entity)?.name ?? null,
      task: asEntityRef(r.sg_task)?.name ?? null,
      user: asEntityRef(r.user)?.name ?? null,
      hasMedia: pickVersionMediaField(r, ctx.settings.media.source) !== null,
      imported: links.has(r.id),
      updatedAt: asDate(r.updated_at),
    }));
}
