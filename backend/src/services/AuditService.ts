import { prisma } from '../lib/prisma';

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
    .catch((err) => console.warn('[Audit] échec :', err instanceof Error ? err.message : err));
}
