// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { displayName, initials, avatarUrl } from '../lib/userView';
import { type PaginationParams, type Paginated, pageArgs, paginate } from '../lib/pagination';

/**
 * Journal d'audit paginé enrichi de l'auteur (avatar/initiales) — flux d'activité admin
 * (Phase 21). L'utilisateur est présigné pour l'avatar ; `null` si l'auteur a été supprimé.
 */
export async function list(p: PaginationParams): Promise<Paginated<unknown>> {
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      ...pageArgs(p),
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            firstName: true,
            lastName: true,
            username: true,
            avatarKey: true,
          },
        },
      },
    }),
    prisma.auditLog.count(),
  ]);
  const items = await Promise.all(
    rows.map(async ({ user, userId, metadata: _metadata, ...row }) => ({
      ...row,
      user: user
        ? {
            id: user.id,
            displayName: displayName(user),
            initials: initials(user),
            avatarUrl: await avatarUrl(user.avatarKey),
          }
        : null,
    })),
  );
  return paginate(items, total, p);
}

/**
 * Journalise une action sensible dans l'audit log (tolérant aux erreurs).
 */
export function logAudit(params: {
  userId?: number | null;
  action: string;
  entityType?: string;
  entityId?: number;
  metadata?: Record<string, unknown>;
}): void {
  void prisma.auditLog
    .create({
      data: {
        userId: params.userId ?? null,
        action: params.action,
        entityType: params.entityType ?? null,
        entityId: params.entityId ?? null,
        metadata: (params.metadata ?? {}) as object,
      },
    })
    .catch((err) => logger.warn({ err }, '[Audit] échec'));
}
