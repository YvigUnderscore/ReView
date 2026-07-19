import { prisma } from './prisma';
import { logger } from './logger';

/**
 * Journal d'accès aux médias (36.E) : qui a visionné quoi / quand — par compte (review
 * interne) ou par lien de partage (page client). Best effort : ne bloque jamais la
 * requête. Dédup : un même acteur sur un même média ne crée pas plus d'une ligne
 * par fenêtre de 30 minutes (rechargements/seeks ≠ nouvelles consultations).
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
