// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { type Router, type Request } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { requireRole, assertProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { notFound } from '../lib/errors';
import { logAudit } from '../services/AuditService';
import { requireUser } from '../middleware/auth';

/**
 * The trash triplet of a pipeline entity: move to trash, restore, purge.
 *
 * Sequences, shots and assets repeated it identically: forty lines each, word for word, except the entity's
 * name in the error message and the audit action. Mounting it once prevents a rule corrected in one place
 * from staying wrong in the other two.
 */
export interface TrashRoutesOptions {
  /** Entity segment for the audit: "Asset", "Shot", "Sequence", "Episode". */
  entityType: 'Asset' | 'Shot' | 'Sequence' | 'Episode';
  /** Prefix of the audit actions: "ASSET", "SHOT", "SEQUENCE", "EPISODE". */
  auditPrefix: string;
  /** Message when the entity does not exist. */
  notFoundMessage: string;
  resolveProjectId: (id: number) => Promise<number | null>;
  softDelete: (userId: number, id: number) => Promise<unknown>;
  restore: (id: number) => Promise<unknown>;
  purge: (userId: number, id: number) => Promise<unknown>;
}

const idParam = z.object({ id: z.coerce.number().int() });

export function mountTrashRoutes(router: Router, options: TrashRoutesOptions) {
  const manage = requireRole(Role.ADMIN, Role.SUPERVISOR);

  const access = async (req: Request, id: number) => {
    const projectId = await options.resolveProjectId(id);
    if (!projectId) throw notFound(options.notFoundMessage);
    await assertProjectAccess(req, projectId);
  };

  router.delete('/:id', manage, validate({ params: idParam }), async (req, res) => {
    const id = Number(req.params.id);
    await access(req, id);
    await options.softDelete(requireUser(req).id, id);
    logAudit({
      userId: requireUser(req).id,
      action: `${options.auditPrefix}_DELETE`,
      entityType: options.entityType,
      entityId: id,
    });
    res.status(204).end();
  });

  router.post('/:id/restore', manage, validate({ params: idParam }), async (req, res) => {
    const id = Number(req.params.id);
    await access(req, id);
    await options.restore(id);
    res.status(204).end();
  });

  router.delete('/:id/purge', manage, validate({ params: idParam }), async (req, res) => {
    const id = Number(req.params.id);
    await access(req, id);
    await options.purge(requireUser(req).id, id);
    logAudit({
      userId: requireUser(req).id,
      action: `${options.auditPrefix}_PURGE`,
      entityType: options.entityType,
      entityId: id,
    });
    res.status(204).end();
  });
}
