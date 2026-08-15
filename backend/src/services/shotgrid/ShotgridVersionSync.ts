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
  attachmentName,
  attachmentUrl,
  type SgRecord,
} from './shotgridMapper';
import { mapSgToLocal, upsertLink, type VersionLinkData } from './shotgridLinks';
import { can } from './shotgridSettings';
import type { PullContext } from './ShotgridPullService';

/**
 * Import des Media Publishes : une Version ShotGrid devient une Version ReView avec
 * son média, prête à être annotée image par image.
 *
 * Le média est transféré en flux vers MinIO puis confié au pipeline habituel
 * (transcodage HLS, miniatures) : un publish venu de ShotGrid se comporte ensuite
 * exactement comme un envoi manuel. Il naît publié — une Version ShotGrid EST une
 * publication, la retenir en brouillon n'aurait pas de sens.
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

/** Tâche fourre-tout d'un plan : accueille les publishes sans tâche ShotGrid explicite. */
const IMPORT_TASK_NAME = 'ShotGrid';

export interface ImportVersionsOptions {
  since?: Date | null;
  /** Versions précises à importer (sélection manuelle depuis l'onglet). */
  onlySgIds?: number[];
  /** Import du fichier média (désactivé pour un simple inventaire). */
  withMedia?: boolean;
}

export async function pullVersions(ctx: PullContext, options: ImportVersionsOptions = {}): Promise<void> {
  if (!can(ctx.settings, 'versions', 'read')) return;

  const filters: Array<[string, string, unknown]> = [projectFilter(ctx.scope.sgProjectId)];
  if (options.since) filters.push(['updated_at', 'greater_than', options.since.toISOString()]);
  if (options.onlySgIds?.length) filters.push(['id', 'in', options.onlySgIds]);

  const records = await ctx.client.search('Version', { fields: VERSION_FIELDS, filters, sort: 'id' });
  const statusFilter = ctx.settings.media.statusFilter;

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
    // Le filtre de statuts ne s'applique qu'à l'import automatique : une sélection
    // manuelle est une décision explicite, elle passe outre.
    if (
      !options.onlySgIds?.length &&
      statusFilter.length > 0 &&
      statusCode &&
      !statusFilter.includes(statusCode)
    ) {
      ctx.journal.count('versions', 'skipped');
      continue;
    }

    try {
      await importVersion(ctx, record, options.withMedia !== false);
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
 * Rattachement d'une Version ShotGrid dans l'arborescence ReView.
 *
 * ShotGrid autorise une Version sans tâche, rattachée directement au plan. ReView
 * range les versions sous une tâche ou un asset : plutôt que d'écarter ces publishes,
 * on leur ouvre une tâche dédiée par plan, visible et identifiable.
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
  const reviewStatusId = statusCode ? (ctx.settings.versionStatusMap[statusCode] ?? null) : null;
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
    reviewStatusId,
    deletedAt: null,
  };

  const version = existing
    ? await prisma.version.update({ where: { id: existing.id }, data })
    : await prisma.version.create({ data });
  ctx.journal.count('versions', existing ? 'updated' : 'created');

  const linkData: VersionLinkData = {
    sgStatusCode: statusCode,
    sgPathToMovie: asString(record.sg_path_to_movie),
    sgFirstFrame: asNumber(record.sg_first_frame),
    sgLastFrame: asNumber(record.sg_last_frame),
    mediaImported: Boolean((existingLink?.data as VersionLinkData | undefined)?.mediaImported),
  };

  /**
   * La correspondance est posée AVANT toute tentative sur le média, et c'est capital :
   * elle dit « cette Version ShotGrid est déjà dans ReView », ce qui est vrai dès
   * maintenant. Poser le lien après le transfert laissait la version orpheline au
   * moindre échec de téléchargement — et la synchronisation suivante, ne retrouvant
   * rien, en recréait une. Une par passe, indéfiniment.
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

  // Le média est un supplément : son échec n'invalide ni la version ni son statut.
  if (withMedia && !linkData.mediaImported && ctx.settings.media.autoImport) {
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
 * Transfert du fichier média.
 *
 * ShotGrid délivre une URL S3 signée de très courte durée : elle est consommée
 * immédiatement, en flux vers MinIO. Un master de dailies pèse plusieurs gigaoctets —
 * le charger en mémoire ferait tomber le worker.
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

  // L'endpoint dédié d'abord, l'adresse portée par le champ ensuite : selon le site et
  // le champ, l'un ou l'autre répond.
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

  const filename = attachmentName(picked.value, `${versionName}.mp4`);
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
  const media = await prisma.mediaObject.create({
    data: {
      versionId,
      kind: kindFromContentType(contentType, filename),
      originalName: filename,
      storageKey: '',
      mimeType: contentType,
      status: MediaStatus.UPLOADING,
      published: true,
      metadata: { importedFromShotgrid: true, sgVersionId: record.id, sgField: picked.field },
    },
  });
  const storageKey = StorageService.mediaKey({
    projectSlug: storageCtx.projectSlug,
    parentSegment: storageCtx.parentSegment,
    versionName: storageCtx.versionName,
    mediaId: media.id,
    filename: filename.replace(/[^\w.-]+/g, '_'),
  });

  // Passage par un fichier temporaire plutôt que par un envoi direct du flux réseau :
  // le stockage objet exige la taille du contenu à l'avance, que ShotGrid ne garantit
  // pas dans ses réponses. Le disque évite aussi de tenir un master en mémoire.
  const tmpPath = join(tmpdir(), `sg-${media.id}-${Date.now()}`);
  let bytes = 0;
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

  await upsertLink({
    connectionId: ctx.connection.id,
    localType: 'media',
    localId: uploaded.id,
    sgType: 'Attachment',
    sgId: record.id,
    data: { field: picked.field, filename },
  });

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
 * Publishes de pipeline (`PublishedFile`) : chemins des fichiers de travail.
 * Conservés en métadonnées sur la version — ReView ne monte pas les stockages du
 * studio, mais afficher le chemin fait gagner un aller-retour vers ShotGrid.
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

/** Versions ShotGrid pas encore importées — alimente la table de sélection manuelle. */
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
