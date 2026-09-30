// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from './prisma';
import { forbidden } from './errors';

/**
 * Quota de stockage par projet (38.D). L'usage d'un projet = somme des tailles des médias
 * (non supprimés) de ses versions, quel que soit le rattachement (shot·séquence ou asset).
 * `Project.storageQuota` en octets ; `null` = illimité.
 */

/** Sélecteur des médias rattachés à un projet (via la version → task/asset). */
const mediaInProject = (projectId: number) => ({
  deletedAt: null,
  version: {
    OR: [{ task: { shot: { projectId } } }, { task: { asset: { projectId } } }, { asset: { projectId } }],
  },
});

/** Octets consommés par un projet (somme des tailles de ses médias non supprimés). */
export async function getProjectStorageUsage(projectId: number): Promise<bigint> {
  const agg = await prisma.mediaObject.aggregate({
    _sum: { size: true },
    where: mediaInProject(projectId),
  });
  return agg._sum.size ?? 0n;
}

/**
 * Refuse l'ajout de `addSize` octets si le projet a un quota et que l'usage le dépasserait
 * (403 PROJECT_QUOTA). Aucun quota (`null`) → toujours autorisé.
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
