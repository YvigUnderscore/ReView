// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from './prisma';
import { forbidden, notFound } from '../lib/errors';

/**
 * Verrou d'archivage (38.B) : un projet ARCHIVED est en lecture seule — toute écriture
 * de contenu/structure est refusée (403 PROJECT_ARCHIVED). Restaurer = repasser le
 * statut à ACTIVE (PATCH /api/projects/:id).
 */
export async function assertProjectWritable(projectId: number): Promise<void> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { status: true },
  });
  if (!project) throw notFound('Project not found');
  if (project.status === 'ARCHIVED') {
    throw forbidden('Archived project — read only', 'PROJECT_ARCHIVED');
  }
}
