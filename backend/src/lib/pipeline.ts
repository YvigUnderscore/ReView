// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from './prisma';
import { slugify } from './slug';

/**
 * Resolvers of the owning project for each pipeline entity.
 * Used for access control (every authorisation is attached to a project).
 * Return `null` if the entity cannot be found.
 */

export const resolveProjectIdForProject = async (id: number): Promise<number | null> => {
  const project = await prisma.project.findUnique({ where: { id }, select: { id: true } });
  return project?.id ?? null;
};

export const resolveProjectIdForEpisode = async (id: number): Promise<number | null> => {
  const episode = await prisma.episode.findUnique({ where: { id }, select: { projectId: true } });
  return episode?.projectId ?? null;
};

export const resolveProjectIdForSequence = async (id: number): Promise<number | null> => {
  const seq = await prisma.sequence.findUnique({ where: { id }, select: { projectId: true } });
  return seq?.projectId ?? null;
};

export const resolveProjectIdForShot = async (id: number): Promise<number | null> => {
  const shot = await prisma.shot.findUnique({ where: { id }, select: { projectId: true } });
  return shot?.projectId ?? null;
};

export const resolveProjectIdForAsset = async (id: number): Promise<number | null> => {
  const asset = await prisma.asset.findUnique({ where: { id }, select: { projectId: true } });
  return asset?.projectId ?? null;
};

export const resolveProjectIdForTask = async (id: number): Promise<number | null> => {
  const task = await prisma.task.findUnique({
    where: { id },
    select: { shot: { select: { projectId: true } }, asset: { select: { projectId: true } } },
  });
  if (!task) return null;
  return task.shot?.projectId ?? task.asset?.projectId ?? null;
};

export const resolveProjectIdForVersion = async (id: number): Promise<number | null> => {
  const version = await prisma.version.findUnique({
    where: { id },
    select: {
      asset: { select: { projectId: true } },
      task: {
        select: { shot: { select: { projectId: true } }, asset: { select: { projectId: true } } },
      },
    },
  });
  if (!version) return null;
  if (version.asset) return version.asset.projectId;
  if (version.task?.shot) return version.task.shot.projectId;
  if (version.task?.asset) return version.task.asset.projectId;
  return null;
};

export const resolveProjectIdForMedia = async (id: number): Promise<number | null> => {
  const media = await prisma.mediaObject.findUnique({ where: { id }, select: { versionId: true } });
  if (!media) return null;
  return resolveProjectIdForVersion(media.versionId);
};

export const resolveProjectIdForComment = async (id: number): Promise<number | null> => {
  const comment = await prisma.comment.findUnique({ where: { id }, select: { mediaObjectId: true } });
  if (!comment) return null;
  return resolveProjectIdForMedia(comment.mediaObjectId);
};

/**
 * Readable context to build an explicit MinIO key from a Version.
 * Resolves the chain Version → (Asset | Task → Shot/Asset) → Project and returns:
 *  - projectSlug: slug of the owning project
 *  - parentSegment: `{sequence?}/{shot}` for a shot, `assets/{asset}` for an asset
 *  - versionName: slugified version name (e.g. v01)
 * Returns `null` if the version cannot be found or is not attached to a project.
 */
export interface StorageContext {
  projectId: number;
  projectSlug: string;
  parentSegment: string;
  versionName: string;
}

export const resolveStorageContextForVersion = async (versionId: number): Promise<StorageContext | null> => {
  const version = await prisma.version.findUnique({
    where: { id: versionId },
    select: {
      name: true,
      asset: { select: { name: true, project: { select: { slug: true, id: true } } } },
      task: {
        select: {
          shot: {
            select: {
              code: true,
              project: { select: { slug: true, id: true } },
              sequence: { select: { code: true } },
            },
          },
          asset: { select: { name: true, project: { select: { slug: true, id: true } } } },
        },
      },
    },
  });
  if (!version) return null;

  const versionName = slugify(version.name) || 'version';

  // Version attached directly to a reusable asset
  if (version.asset) {
    return {
      projectId: version.asset.project.id,
      projectSlug: version.asset.project.slug,
      parentSegment: `assets/${slugify(version.asset.name) || 'asset'}`,
      versionName,
    };
  }
  // Version of a task on a shot
  const shot = version.task?.shot;
  if (shot) {
    const seqSeg = shot.sequence?.code ? `${slugify(shot.sequence.code)}/` : '';
    return {
      projectId: shot.project.id,
      projectSlug: shot.project.slug,
      parentSegment: `shots/${seqSeg}${slugify(shot.code) || 'shot'}`,
      versionName,
    };
  }
  // Version of a task on an asset
  const taskAsset = version.task?.asset;
  if (taskAsset) {
    return {
      projectId: taskAsset.project.id,
      projectSlug: taskAsset.project.slug,
      parentSegment: `assets/${slugify(taskAsset.name) || 'asset'}`,
      versionName,
    };
  }
  return null;
};
