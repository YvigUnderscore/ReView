import { Router } from 'express';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { Role, SharePermission } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { requireRole, assertProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { logAudit } from '../services/AuditService';
import { notFound } from '../lib/errors';

const router = Router();
router.use(authenticate);

// GET /api/share?projectId=X — liste les liens de partage d'un projet (superviseur/admin)
router.get(
  '/',
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  validate({ query: z.object({ projectId: z.coerce.number().int() }) }),
  async (req, res) => {
    const projectId = Number(req.query.projectId);
    await assertProjectAccess(req, projectId);
    const links = await prisma.shareLink.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } });
    res.json({ links });
  },
);

// POST /api/share — crée un lien de partage révocable à durée de vie configurable
router.post(
  '/',
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  validate({
    body: z.object({
      projectId: z.number().int(),
      permission: z.nativeEnum(SharePermission).default(SharePermission.VIEW),
      expiresInDays: z.number().int().positive().max(3650).optional(),
    }),
  }),
  async (req, res) => {
    const { projectId, permission, expiresInDays } = req.body as {
      projectId: number;
      permission: SharePermission;
      expiresInDays?: number;
    };
    await assertProjectAccess(req, projectId);
    const token = randomBytes(24).toString('hex');
    const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 86_400_000) : null;
    const link = await prisma.shareLink.create({
      data: { token, projectId, permission, expiresAt, createdById: req.user!.id },
    });
    logAudit({
      userId: req.user!.id,
      action: 'SHARE_CREATE',
      entityType: 'Project',
      entityId: projectId,
      metadata: { permission },
    });
    res.status(201).json({ link });
  },
);

// DELETE /api/share/:id — révoque un lien (superviseur/admin)
router.delete(
  '/:id',
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  validate({ params: z.object({ id: z.coerce.number().int() }) }),
  async (req, res) => {
    const id = Number(req.params.id);
    const link = await prisma.shareLink.findUnique({ where: { id }, select: { projectId: true } });
    if (!link) throw notFound('Lien introuvable');
    await assertProjectAccess(req, link.projectId);
    await prisma.shareLink.update({ where: { id }, data: { revoked: true } });
    res.status(204).end();
  },
);

export default router;
