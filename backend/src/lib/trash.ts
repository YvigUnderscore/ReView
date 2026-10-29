// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from './prisma';
import { storage } from './storage';
import { enqueueStorageCleanup } from './queues';
import { logger } from './logger';

/**
 * Trash: soft-delete / restore / permanent purge, with downward cascade and cleanup of MinIO
 * objects on purge.
 *
 * Cascade (soft-delete & restore):
 *   Sequence → Shots
 *   Asset    → Versions → Medias
 *   Version  → Medias
 *   Shot / Media: no child carrying deletedAt
 *   Project  : marked alone (its listings are already filtered by visible project)
 *
 * Note: restoring a parent also restores its deleted descendants.
 */

type MediaKeys = {
  id: number;
  storageKey: string;
  thumbnailKey: string | null;
  imageSequence?: { storagePrefix: string } | null;
};

/**
 * What must be read from a media in order to free everything it occupies.
 *
 * `imageSequence.storagePrefix` is the only place in the database that names the frames of an
 * image sequence (`projects/…/{mediaId}/frames/`). As long as the purge did not read it,
 * destroying a delivery of 2,000 EXRs erased the row and the manifest but left the eighty
 * gigabytes of frames in the bucket, with nothing left in the database to name them, so they
 * could only be found by sweeping the storage by hand.
 */
const MEDIA_STORAGE_SELECT = {
  id: true,
  storageKey: true,
  thumbnailKey: true,
  imageSequence: { select: { storagePrefix: true } },
} as const;

/** Flattens the storage keys (media + thumbnail) of a list of media. */
function mediaStorageKeys(medias: MediaKeys[]): string[] {
  const keys: string[] = [];
  for (const m of medias) {
    if (m.storageKey) keys.push(m.storageKey);
    if (m.thumbnailKey) keys.push(m.thumbnailKey);
  }
  return keys;
}

/**
 * A media's own folder, deduced from its source key.
 *
 * `StorageService.mediaKey` always places a media in a folder that carries its identifier:
 * `projects/{project}/{parent}/{version}/{mediaId}/{file}`. This folder therefore belongs to it
 * alone, and it is there that, next to the original file, the `sequence.json` manifest and the
 * `frames/` subfolder of an image sequence live.
 *
 * The `/{id}/` suffix is REQUIRED before the prefix is returned: it is the proof that the folder
 * is indeed that of this media. Without it, an unexpected key (empty: media created but not yet
 * named; or inherited from an old convention) would delete a prefix holding someone else's work,
 * or even the whole bucket. No prefix is better than an overly broad one: the frames would then
 * fall back to `storagePrefix`.
 */
function mediaFolderPrefix(media: MediaKeys): string | null {
  const slash = media.storageKey.lastIndexOf('/');
  if (slash <= 0) return null;
  const folder = media.storageKey.slice(0, slash + 1);
  return folder.endsWith(`/${media.id}/`) ? folder : null;
}

/**
 * MinIO prefixes that belong only to these media.
 *
 * Two families. (1) Everything the workers produce lives under `derived/{mediaId}/`: HLS
 * renditions, MP4 proxy, client derivative, timeline sprite, converted GLB, spatial thumbnails,
 * splat ops. These objects make up the bulk of the bucket: a purge that only deleted
 * `storageKey` and `thumbnailKey` freed almost nothing, and for a video nothing at all, since
 * the original is already replaced by its proxy at the end of transcoding.
 * (2) The media's folder, which carries the original file, the sequence manifest and its frames,
 * and, by construction, any derivative one would store beside them tomorrow. When this folder
 * cannot be proven (cf. `mediaFolderPrefix`), we fall back to the only frames prefix the
 * database knows.
 */
function mediaOwnedPrefixes(medias: MediaKeys[]): string[] {
  const prefixes: string[] = [];
  for (const media of medias) {
    prefixes.push(`derived/${media.id}/`);
    const folder = mediaFolderPrefix(media);
    if (folder) prefixes.push(folder);
    else if (media.imageSequence?.storagePrefix) prefixes.push(media.imageSequence.storagePrefix);
  }
  return prefixes;
}

/**
 * Prefixes processed together. Each prefix costs at least one `ListObjectsV2` followed by a
 * `DeleteObjects`: chaining them strictly one after the other turned the purge of two hundred
 * media into hundreds of serial round trips, in the HTTP request's thread. Eight is enough to
 * hide the latency without turning a cleanup into a load on MinIO.
 */
const PREFIX_DELETE_CONCURRENCY = 8;

/**
 * Deletes the prefixes with bounded parallelism and returns those that failed, **in input
 * order**: what the orphan log re-queues must remain reproducible.
 */
async function deletePrefixes(prefixes: string[]): Promise<string[]> {
  const failed: (string | null)[] = new Array<string | null>(prefixes.length).fill(null);
  let next = 0;
  const run = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      const prefix = prefixes[index];
      if (prefix === undefined) return;
      try {
        await storage.deletePrefix(prefix);
      } catch (err) {
        failed[index] = prefix;
        logger.warn({ err, prefix }, '[Trash] storage prefix deletion failed (retry queued)');
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(PREFIX_DELETE_CONCURRENCY, prefixes.length) }, () => run()),
  );
  return failed.filter((prefix): prefix is string => prefix !== null);
}

/**
 * Deletes MinIO objects **after** the DB has been purged. Never throws: a storage failure no
 * longer affects DB consistency (already committed). Keys that failed are logged and queued for
 * retry (orphan log, cf. 10.D7).
 *
 * Keys go out as a **multiple deletion** (`DeleteObjects`, 1,000 per call) rather than one by
 * one. If the transport drops, the whole batch is re-queued instead of only the keys that really
 * failed: deleting an already absent object has no effect, so the final state of the bucket is
 * identical; we simply retry a little wider.
 */
async function deleteStorageAfterCommit(keys: string[], prefixes: string[] = []): Promise<void> {
  let failedKeys: string[] = [];
  if (keys.length > 0) {
    try {
      failedKeys = await storage.deleteObjects(keys);
      if (failedKeys.length > 0)
        logger.warn({ keys: failedKeys }, '[Trash] storage object deletion refused (retry queued)');
    } catch (err) {
      failedKeys = [...keys];
      logger.warn({ err, count: keys.length }, '[Trash] storage objects deletion failed (retry queued)');
    }
  }
  const failedPrefixes = await deletePrefixes(prefixes);
  if (failedKeys.length > 0 || failedPrefixes.length > 0) {
    await enqueueStorageCleanup({ keys: failedKeys, prefixes: failedPrefixes }).catch((err) =>
      logger.error(
        { err, keys: failedKeys, prefixes: failedPrefixes },
        '[Trash] could not queue the storage cleanup — orphans will not be retried',
      ),
    );
  }
}

// ── Soft-delete ───────────────────────────────────────────────────────────────

export async function softDeleteSequence(id: number): Promise<void> {
  const now = new Date();
  await prisma.$transaction([
    prisma.shot.updateMany({ where: { sequenceId: id }, data: { deletedAt: now } }),
    prisma.sequence.update({ where: { id }, data: { deletedAt: now } }),
  ]);
}

export async function softDeleteShot(id: number): Promise<void> {
  await prisma.shot.update({ where: { id }, data: { deletedAt: new Date() } });
}

/**
 * Episode: no cascade, unlike the sequence.
 *
 * An episode groups sequences, it does not own them. Taking its sequences with it, and behind
 * them the shots, versions and comments, would turn a tidying gesture into the destruction of
 * production. The attachment (`episodeId`) is kept as is: restoring brings the episode back
 * exactly as it was.
 */
export async function softDeleteEpisode(id: number): Promise<void> {
  await prisma.episode.update({ where: { id }, data: { deletedAt: new Date() } });
}

export async function softDeleteAsset(id: number): Promise<void> {
  const now = new Date();
  await prisma.$transaction([
    prisma.mediaObject.updateMany({ where: { version: { assetId: id } }, data: { deletedAt: now } }),
    prisma.version.updateMany({ where: { assetId: id }, data: { deletedAt: now } }),
    prisma.asset.update({ where: { id }, data: { deletedAt: now } }),
  ]);
}

export async function softDeleteVersion(id: number): Promise<void> {
  const now = new Date();
  await prisma.$transaction([
    prisma.mediaObject.updateMany({ where: { versionId: id }, data: { deletedAt: now } }),
    prisma.version.update({ where: { id }, data: { deletedAt: now } }),
  ]);
}

export async function softDeleteMedia(id: number): Promise<void> {
  await prisma.mediaObject.update({ where: { id }, data: { deletedAt: new Date() } });
}

export async function softDeleteProject(id: number): Promise<void> {
  await prisma.project.update({ where: { id }, data: { deletedAt: new Date() } });
}

// ── Bulk soft-delete (13.C) ───────────────────────────────────────────────────
// One transaction per domain (updateMany), with the same downward cascade as the single
// variant. The ids have already been validated (project access) by the calling BulkService.

export async function softDeleteSequences(ids: number[]): Promise<void> {
  const now = new Date();
  await prisma.$transaction([
    prisma.shot.updateMany({ where: { sequenceId: { in: ids } }, data: { deletedAt: now } }),
    prisma.sequence.updateMany({ where: { id: { in: ids } }, data: { deletedAt: now } }),
  ]);
}

export async function softDeleteShots(ids: number[]): Promise<void> {
  await prisma.shot.updateMany({ where: { id: { in: ids } }, data: { deletedAt: new Date() } });
}

export async function softDeleteEpisodes(ids: number[]): Promise<void> {
  await prisma.episode.updateMany({ where: { id: { in: ids } }, data: { deletedAt: new Date() } });
}

export async function softDeleteAssets(ids: number[]): Promise<void> {
  const now = new Date();
  await prisma.$transaction([
    prisma.mediaObject.updateMany({ where: { version: { assetId: { in: ids } } }, data: { deletedAt: now } }),
    prisma.version.updateMany({ where: { assetId: { in: ids } }, data: { deletedAt: now } }),
    prisma.asset.updateMany({ where: { id: { in: ids } }, data: { deletedAt: now } }),
  ]);
}

export async function softDeleteVersions(ids: number[]): Promise<void> {
  const now = new Date();
  await prisma.$transaction([
    prisma.mediaObject.updateMany({ where: { versionId: { in: ids } }, data: { deletedAt: now } }),
    prisma.version.updateMany({ where: { id: { in: ids } }, data: { deletedAt: now } }),
  ]);
}

export async function softDeleteMedias(ids: number[]): Promise<void> {
  await prisma.mediaObject.updateMany({ where: { id: { in: ids } }, data: { deletedAt: new Date() } });
}

export async function softDeleteProjects(ids: number[]): Promise<void> {
  await prisma.project.updateMany({ where: { id: { in: ids } }, data: { deletedAt: new Date() } });
}

// ── Restore ────────────────────────────────────────────────────────────────

export async function restoreSequence(id: number): Promise<void> {
  await prisma.$transaction([
    prisma.shot.updateMany({ where: { sequenceId: id }, data: { deletedAt: null } }),
    prisma.sequence.update({ where: { id }, data: { deletedAt: null } }),
  ]);
}

export async function restoreShot(id: number): Promise<void> {
  await prisma.shot.update({ where: { id }, data: { deletedAt: null } });
}

export async function restoreEpisode(id: number): Promise<void> {
  await prisma.episode.update({ where: { id }, data: { deletedAt: null } });
}

export async function restoreAsset(id: number): Promise<void> {
  await prisma.$transaction([
    prisma.mediaObject.updateMany({ where: { version: { assetId: id } }, data: { deletedAt: null } }),
    prisma.version.updateMany({ where: { assetId: id }, data: { deletedAt: null } }),
    prisma.asset.update({ where: { id }, data: { deletedAt: null } }),
  ]);
}

export async function restoreVersion(id: number): Promise<void> {
  await prisma.$transaction([
    prisma.mediaObject.updateMany({ where: { versionId: id }, data: { deletedAt: null } }),
    prisma.version.update({ where: { id }, data: { deletedAt: null } }),
  ]);
}

export async function restoreMedia(id: number): Promise<void> {
  await prisma.mediaObject.update({ where: { id }, data: { deletedAt: null } });
}

export async function restoreProject(id: number): Promise<void> {
  await prisma.project.update({ where: { id }, data: { deletedAt: null } });
}

// ── Bulk restore (13.C) ────────────────────────────────────────────────

export async function restoreSequences(ids: number[]): Promise<void> {
  await prisma.$transaction([
    prisma.shot.updateMany({ where: { sequenceId: { in: ids } }, data: { deletedAt: null } }),
    prisma.sequence.updateMany({ where: { id: { in: ids } }, data: { deletedAt: null } }),
  ]);
}

export async function restoreShots(ids: number[]): Promise<void> {
  await prisma.shot.updateMany({ where: { id: { in: ids } }, data: { deletedAt: null } });
}

export async function restoreEpisodes(ids: number[]): Promise<void> {
  await prisma.episode.updateMany({ where: { id: { in: ids } }, data: { deletedAt: null } });
}

export async function restoreAssets(ids: number[]): Promise<void> {
  await prisma.$transaction([
    prisma.mediaObject.updateMany({
      where: { version: { assetId: { in: ids } } },
      data: { deletedAt: null },
    }),
    prisma.version.updateMany({ where: { assetId: { in: ids } }, data: { deletedAt: null } }),
    prisma.asset.updateMany({ where: { id: { in: ids } }, data: { deletedAt: null } }),
  ]);
}

export async function restoreVersions(ids: number[]): Promise<void> {
  await prisma.$transaction([
    prisma.mediaObject.updateMany({ where: { versionId: { in: ids } }, data: { deletedAt: null } }),
    prisma.version.updateMany({ where: { id: { in: ids } }, data: { deletedAt: null } }),
  ]);
}

export async function restoreMedias(ids: number[]): Promise<void> {
  await prisma.mediaObject.updateMany({ where: { id: { in: ids } }, data: { deletedAt: null } });
}

export async function restoreProjects(ids: number[]): Promise<void> {
  await prisma.project.updateMany({ where: { id: { in: ids } }, data: { deletedAt: null } });
}

// ── Permanent purge (DB + MinIO) ────────────────────────────────────────────────

// Invariant 10.D7: the DB deletion (atomic via cascade) ALWAYS precedes the storage deletion.
// A MinIO failure therefore never leaves the DB inconsistent; orphaned objects are logged and
// retried (deleteStorageAfterCommit).

export async function purgeMedia(id: number): Promise<void> {
  const media = await prisma.mediaObject.findUnique({
    where: { id },
    select: MEDIA_STORAGE_SELECT,
  });
  if (!media) return;
  await prisma.mediaObject.delete({ where: { id } });
  await deleteStorageAfterCommit(mediaStorageKeys([media]), mediaOwnedPrefixes([media]));
}

export async function purgeVersion(id: number): Promise<void> {
  const medias = await prisma.mediaObject.findMany({
    where: { versionId: id },
    select: MEDIA_STORAGE_SELECT,
  });
  await prisma.version.delete({ where: { id } }); // DB cascade to the media
  await deleteStorageAfterCommit(mediaStorageKeys(medias), mediaOwnedPrefixes(medias));
}

export async function purgeShot(id: number): Promise<void> {
  const medias = await prisma.mediaObject.findMany({
    where: { version: { task: { shotId: id } } },
    select: MEDIA_STORAGE_SELECT,
  });
  await prisma.shot.delete({ where: { id } }); // DB cascade: tasks → versions → media
  await deleteStorageAfterCommit(mediaStorageKeys(medias), mediaOwnedPrefixes(medias));
}

export async function purgeAsset(id: number): Promise<void> {
  const medias = await prisma.mediaObject.findMany({
    where: { version: { OR: [{ assetId: id }, { task: { assetId: id } }] } },
    select: MEDIA_STORAGE_SELECT,
  });
  await prisma.asset.delete({ where: { id } });
  await deleteStorageAfterCommit(mediaStorageKeys(medias), mediaOwnedPrefixes(medias));
}

export async function purgeSequence(id: number): Promise<void> {
  // Deleting a sequence sets sequenceId to null on its shots (SetNull): no media to purge here.
  await prisma.sequence.delete({ where: { id } });
}

/**
 * Purge of an episode. Its sequences survive, simply detached (`ON DELETE SET NULL`): an
 * episode is a grouping, not an owner, so destroying it must not take along any shot, version or
 * comment. No MinIO object to remove.
 */
export async function purgeEpisode(id: number): Promise<void> {
  await prisma.episode.delete({ where: { id } });
}

export async function purgeProject(id: number): Promise<void> {
  const project = await prisma.project.findUnique({ where: { id }, select: { slug: true } });
  if (!project) return;
  await prisma.project.delete({ where: { id } }); // full DB cascade
  // Storage after commit: new readable keys + old numeric keys (legacy).
  await deleteStorageAfterCommit([], [`projects/${project.slug}/`, `projects/${id}/`]);
}

// ── Bulk permanent purge (13.C) ───────────────────────────────────────────────

/**
 * Bulk purge, the exact counterpart of the plural `softDelete*` / `restore*`.
 *
 * Until now the grouped path called the single purge in a loop: two hundred media cost two
 * hundred reads, two hundred deletions and four hundred serial MinIO round trips, all in the
 * HTTP request's thread. Here the batch is read in one pass, deleted in one pass, and the
 * storage is cleaned by a single `DeleteObjects` followed by the prefixes with bounded
 * parallelism.
 *
 * Same invariant 10.D7: the DB first, the storage after. A deliberate difference from the single
 * loop: a `deleteMany` is all-or-nothing, whereas the loop used to leave behind the items already
 * purged. The nominal path, however, produces exactly the same state.
 * The ids have already been validated (project access) by the calling BulkService.
 */
const byIdAsc = { orderBy: { id: 'asc' } } as const;

export async function purgeMedias(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const medias = await prisma.mediaObject.findMany({
    where: { id: { in: ids } },
    select: MEDIA_STORAGE_SELECT,
    ...byIdAsc,
  });
  await prisma.mediaObject.deleteMany({ where: { id: { in: ids } } });
  await deleteStorageAfterCommit(mediaStorageKeys(medias), mediaOwnedPrefixes(medias));
}

export async function purgeVersions(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const medias = await prisma.mediaObject.findMany({
    where: { versionId: { in: ids } },
    select: MEDIA_STORAGE_SELECT,
    ...byIdAsc,
  });
  await prisma.version.deleteMany({ where: { id: { in: ids } } }); // DB cascade to the media
  await deleteStorageAfterCommit(mediaStorageKeys(medias), mediaOwnedPrefixes(medias));
}

export async function purgeShots(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const medias = await prisma.mediaObject.findMany({
    where: { version: { task: { shotId: { in: ids } } } },
    select: MEDIA_STORAGE_SELECT,
    ...byIdAsc,
  });
  await prisma.shot.deleteMany({ where: { id: { in: ids } } }); // cascade: tasks → versions → media
  await deleteStorageAfterCommit(mediaStorageKeys(medias), mediaOwnedPrefixes(medias));
}

export async function purgeAssets(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const medias = await prisma.mediaObject.findMany({
    where: { version: { OR: [{ assetId: { in: ids } }, { task: { assetId: { in: ids } } }] } },
    select: MEDIA_STORAGE_SELECT,
    ...byIdAsc,
  });
  await prisma.asset.deleteMany({ where: { id: { in: ids } } });
  await deleteStorageAfterCommit(mediaStorageKeys(medias), mediaOwnedPrefixes(medias));
}

/** Sequences: their shots are detached (SetNull), no MinIO object to remove. */
export async function purgeSequences(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await prisma.sequence.deleteMany({ where: { id: { in: ids } } });
}

/** Episodes: their sequences are detached (SetNull), no MinIO object to remove. */
export async function purgeEpisodes(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await prisma.episode.deleteMany({ where: { id: { in: ids } } });
}

export async function purgeProjects(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const projects = await prisma.project.findMany({
    where: { id: { in: ids } },
    select: { id: true, slug: true },
    ...byIdAsc,
  });
  if (projects.length === 0) return;
  await prisma.project.deleteMany({ where: { id: { in: projects.map((p) => p.id) } } });
  // New readable keys + old numeric keys (legacy), as in the single variant.
  await deleteStorageAfterCommit(
    [],
    projects.flatMap((p) => [`projects/${p.slug}/`, `projects/${p.id}/`]),
  );
}

// ── Automatic purge (scheduled sweep) ────────────────────────────────────────

/**
 * Ceiling of one automatic purge pass. Each item costs a DB transaction **and** one or more
 * MinIO calls: emptying a feature film's trash in one go would keep the worker busy for hours and
 * hammer the storage while the studio works. The purge is idempotent and resumes where it
 * stopped on the next pass.
 */
export const TRASH_PURGE_MAX_ITEMS = 2000;

/**
 * Permanently purges every trash item older than `retentionDays` days, up to the limit of
 * `maxItems` items per pass.
 * `retentionDays <= 0` disables the automatic purge (no-op).
 * Order: children before parents, to avoid cascade conflicts.
 */
export async function purgeExpiredTrash(
  retentionDays: number,
  maxItems: number = TRASH_PURGE_MAX_ITEMS,
): Promise<number> {
  if (!retentionDays || retentionDays <= 0) return 0;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const expired = { deletedAt: { lt: cutoff, not: null } } as const;
  let budget = Math.max(0, Math.trunc(maxItems));
  let purged = 0;

  /** Consumes the remaining budget on one level of the hierarchy, from oldest to newest. */
  const sweep = async (
    find: (take: number) => Promise<{ id: number }[]>,
    purgeOne: (id: number) => Promise<void>,
  ): Promise<void> => {
    if (budget <= 0) return;
    for (const row of await find(budget)) {
      await purgeOne(row.id);
      purged += 1;
      budget -= 1;
    }
  };

  const page = { where: expired, select: { id: true }, orderBy: { id: 'asc' } } as const;
  await sweep((take) => prisma.mediaObject.findMany({ ...page, take }), purgeMedia);
  await sweep((take) => prisma.version.findMany({ ...page, take }), purgeVersion);
  await sweep((take) => prisma.shot.findMany({ ...page, take }), purgeShot);
  await sweep((take) => prisma.sequence.findMany({ ...page, take }), purgeSequence);
  // After the sequences: they do not depend on their episode (SetNull), but the order
  // children → parents remains the rule of the sweep.
  await sweep((take) => prisma.episode.findMany({ ...page, take }), purgeEpisode);
  await sweep((take) => prisma.asset.findMany({ ...page, take }), purgeAsset);
  await sweep((take) => prisma.project.findMany({ ...page, take }), purgeProject);

  return purged;
}
