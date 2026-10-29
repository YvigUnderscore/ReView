// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from './prisma';
import { forbidden } from './errors';

/**
 * Storage quota per project (38.D). The usage of a project = sum of the sizes of the media (not deleted) of its versions, whatever
 * the attachment (shot·sequence or asset). `Project.storageQuota` in bytes; `null` = unlimited.
 */

/** Selector of the media attached to a project (via the version → task/asset). */
const mediaInProject = (projectId: number) => ({
  deletedAt: null,
  version: {
    OR: [{ task: { shot: { projectId } } }, { task: { asset: { projectId } } }, { asset: { projectId } }],
  },
});

/** Bytes consumed by a project (sum of the sizes of its non-deleted media). */
export async function getProjectStorageUsage(projectId: number): Promise<bigint> {
  const agg = await prisma.mediaObject.aggregate({
    _sum: { size: true },
    where: mediaInProject(projectId),
  });
  return agg._sum.size ?? 0n;
}

/**
 * Refuses the addition of `addSize` bytes if the project has a quota and usage would exceed it (403 PROJECT_QUOTA).
 * No quota (`null`) → always allowed.
 */
export async function assertProjectQuota(projectId: number, addSize: number): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { storageQuota: true },
  });
  const quota = project?.storageQuota;
  if (quota == null) return;
  const used = await getProjectStorageUsage(projectId);
  if (used + BigInt(Math.max(0, Math.trunc(addSize))) > quota) {
    throw forbidden('Project storage quota exceeded', 'PROJECT_QUOTA');
  }
}
