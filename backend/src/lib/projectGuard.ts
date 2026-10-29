// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from './prisma';
import { forbidden, notFound } from '../lib/errors';

/**
 * Archive lock (38.B): an ARCHIVED project is read-only — any write of content/structure is refused (403 PROJECT_ARCHIVED).
 * Restoring = setting the status back to ACTIVE (PATCH /api/projects/:id).
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
