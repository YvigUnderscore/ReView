// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Role, SharePermission } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { requireRole, assertProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { logAudit } from '../services/AuditService';
import { notFound } from '../lib/errors';

const router = Router();
router.use(authenticate);

// Champs renvoyés à l'admin — jamais le hash du mot de passe, un booléen suffit.
const linkSelect = {
  id: true,
  token: true,
  projectId: true,
  permission: true,
  label: true,
  maxViews: true,
  viewCount: true,
  lastViewedAt: true,
  expiresAt: true,
  revoked: true,
  createdAt: true,
  createdBy: { select: { id: true, name: true } },
} as const;

const withHasPassword = <T extends { id: number }>(link: T, passwordHash: string | null) => ({
  ...link,
  hasPassword: passwordHash != null,
});

// GET /api/share?projectId=X — liste les liens de partage d'un projet (superviseur/admin)
router.get(
  '/',
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  validate({ query: z.object({ projectId: z.coerce.number().int() }) }),
  async (req, res) => {
    const projectId = Number(req.query.projectId);
    await assertProjectAccess(req, projectId);
    const links = await prisma.shareLink.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      select: { ...linkSelect, passwordHash: true },
    });
    res.json({ links: links.map(({ passwordHash, ...l }) => withHasPassword(l, passwordHash)) });
  },
);

// POST /api/share — crée un lien durci (35.C) : label, mot de passe, expiration, limite de vues
router.post(
  '/',
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  validate({
    body: z.object({
      projectId: z.number().int(),
      permission: z.nativeEnum(SharePermission).default(SharePermission.VIEW),
      label: z.string().trim().min(1).max(120).optional(),
      password: z.string().min(4).max(200).optional(),
      maxViews: z.number().int().positive().max(1_000_000).optional(),
      expiresInDays: z.number().int().positive().max(3650).optional(),
    }),
  }),
  async (req, res) => {
    const body = req.body as {
      projectId: number;
      permission: SharePermission;
      label?: string;
      password?: string;
      maxViews?: number;
      expiresInDays?: number;
    };
    await assertProjectAccess(req, body.projectId);
    const token = randomBytes(24).toString('hex');
    const expiresAt = body.expiresInDays ? new Date(Date.now() + body.expiresInDays * 86_400_000) : null;
    const passwordHash = body.password ? await bcrypt.hash(body.password, 12) : null;
    const link = await prisma.shareLink.create({
      data: {
        token,
        projectId: body.projectId,
        permission: body.permission,
        label: body.label ?? null,
        passwordHash,
        maxViews: body.maxViews ?? null,
        expiresAt,
        createdById: req.user!.id,
      },
      select: linkSelect,
    });
    logAudit({
      userId: req.user!.id,
      action: 'SHARE_CREATE',
      entityType: 'Project',
      entityId: body.projectId,
      metadata: {
        permission: body.permission,
        label: body.label ?? null,
        hasPassword: passwordHash != null,
        maxViews: body.maxViews ?? null,
        expiresAt: expiresAt?.toISOString() ?? null,
      },
    });
    res.status(201).json({ link: withHasPassword(link, passwordHash) });
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
    logAudit({
      userId: req.user!.id,
      action: 'SHARE_REVOKE',
      entityType: 'Project',
      entityId: link.projectId,
      metadata: { shareLinkId: id },
    });
    res.status(204).end();
  },
);

export default router;
