// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from './prisma';
import { logger } from './logger';

/**
 * Media access log (36.E): who viewed what and when — per account (internal review) or per share link (client
 * page). Best effort: never blocks the request. Dedup: the same actor on the same media creates at most one row per
 * 30-minute window (reloads/seeks are not new views).
 */

const DEDUP_WINDOW_MS = 30 * 60 * 1000;

export function logMediaAccess(params: {
  mediaObjectId: number;
  userId?: number | null;
  shareLinkId?: number | null;
  ip?: string | null;
}): void {
  void (async () => {
    const since = new Date(Date.now() - DEDUP_WINDOW_MS);
    const recent = await prisma.mediaAccessLog.findFirst({
      where: {
        mediaObjectId: params.mediaObjectId,
        userId: params.userId ?? null,
        shareLinkId: params.shareLinkId ?? null,
        createdAt: { gte: since },
      },
      select: { id: true },
    });
    if (recent) return;
    await prisma.mediaAccessLog.create({
      data: {
        mediaObjectId: params.mediaObjectId,
        userId: params.userId ?? null,
        shareLinkId: params.shareLinkId ?? null,
        ip: params.ip ?? null,
      },
    });
  })().catch((err) => logger.warn({ err }, '[mediaAccess] échec de journalisation'));
}
