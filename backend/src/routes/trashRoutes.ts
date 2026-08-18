// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { type Router, type Request } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { requireRole, assertProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { notFound } from '../lib/errors';
import { logAudit } from '../services/AuditService';

/**
 * Le triplet corbeille d'une entité de pipe : mise à la corbeille, restauration, purge.
 *
 * Séquences, plans et assets le répétaient à l'identique — quarante lignes chacun, au mot
 * près, sauf le nom de l'entité dans le message d'erreur et l'action d'audit. Le monter
 * une fois évite qu'une règle corrigée à un endroit reste fausse aux deux autres.
 */
export interface TrashRoutesOptions {
  /** Segment d'entité pour l'audit — « Asset », « Shot », « Sequence ». */
  entityType: 'Asset' | 'Shot' | 'Sequence';
  /** Préfixe des actions d'audit — « ASSET », « SHOT », « SEQUENCE ». */
  auditPrefix: string;
  /** Message quand l'entité n'existe pas. */
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
    await options.softDelete(req.user!.id, id);
    logAudit({
      userId: req.user!.id,
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
    await options.purge(req.user!.id, id);
    logAudit({
      userId: req.user!.id,
      action: `${options.auditPrefix}_PURGE`,
      entityType: options.entityType,
      entityId: id,
    });
    res.status(204).end();
  });
}
