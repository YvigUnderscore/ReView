// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { Role, VersionStatus, MediaKind } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { paginationQuery, readPagination } from '../lib/pagination';
import { revokeSession } from '../lib/sessions';
import { notFound } from '../lib/errors';
import { logAudit } from '../services/AuditService';
import * as AdminUserService from '../services/AdminUserService';
import * as AdminProjectService from '../services/AdminProjectService';
import * as AdminContentService from '../services/AdminContentService';
import { storageReport } from '../services/AdminStorageService';

/**
 * Explorateur d'administration (refonte admin) : fiches détaillées par entité —
 * utilisateurs, projets (hiérarchie + héritage pipeline), versions et commentaires
 * globaux, cartographie du stockage MinIO. Lecture seule sauf révocation de session ;
 * les actions d'écriture passent par les routes existantes (users, comments…).
 */
const router = Router();
router.use(authenticate, requireRole(Role.ADMIN));

const idParam = z.object({ id: z.coerce.number().int() });

// GET /api/admin/users/:id — fiche détaillée d'un compte (projets, sessions, activité)
router.get('/users/:id', validate({ params: idParam }), async (req, res) => {
  res.json(await AdminUserService.userDetail(Number(req.params.id)));
});

// DELETE /api/admin/sessions/:sid — révoque une session précise de n'importe quel compte
router.delete(
  '/sessions/:sid',
  validate({ params: z.object({ sid: z.string().length(32) }) }),
  async (req, res) => {
    const ok = await revokeSession(String(req.params.sid));
    if (!ok) throw notFound('Session not found');
    logAudit({
      userId: req.user!.id,
      action: 'SESSION_REVOKE',
      entityType: 'UserSession',
      metadata: { byAdmin: true },
    });
    res.status(204).end();
  },
);

// GET /api/admin/projects — liste enrichie (compteurs, stockage, quota)
router.get('/projects', async (_req, res) => {
  res.json({ projects: await AdminProjectService.listProjects() });
});

// GET /api/admin/projects/:id — fiche projet (membres, réglages résolus, hiérarchie)
router.get('/projects/:id', validate({ params: idParam }), async (req, res) => {
  res.json(await AdminProjectService.projectDetail(Number(req.params.id)));
});

// GET /api/admin/versions — versions de tous les projets, filtrables et paginées
const versionsQuery = paginationQuery.extend({
  projectId: z.coerce.number().int().optional(),
  status: z.nativeEnum(VersionStatus).optional(),
  published: z.enum(['true', 'false']).optional(),
  kind: z.nativeEnum(MediaKind).optional(),
  q: z.string().max(120).optional(),
});
router.get('/versions', validate({ query: versionsQuery }), async (req, res) => {
  // Express 5 : req.query est un getter — on re-parse pour des valeurs typées fiables.
  const f = versionsQuery.parse(req.query);
  res.json(
    await AdminContentService.listVersions(
      {
        projectId: f.projectId,
        status: f.status,
        kind: f.kind,
        published: f.published === undefined ? undefined : f.published === 'true',
        q: f.q,
      },
      readPagination(req.query),
    ),
  );
});

// GET /api/admin/comments — commentaires de tout le studio (recherche + modération)
const commentsQuery = paginationQuery.extend({
  projectId: z.coerce.number().int().optional(),
  authorId: z.coerce.number().int().optional(),
  resolved: z.enum(['true', 'false']).optional(),
  q: z.string().max(120).optional(),
});
router.get('/comments', validate({ query: commentsQuery }), async (req, res) => {
  const f = commentsQuery.parse(req.query);
  res.json(
    await AdminContentService.listComments(
      {
        projectId: f.projectId,
        authorId: f.authorId,
        resolved: f.resolved === undefined ? undefined : f.resolved === 'true',
        q: f.q,
      },
      readPagination(req.query),
    ),
  );
});

// GET /api/admin/storage — cartographie du stockage MinIO (scan complet du bucket)
router.get('/storage', async (_req, res) => {
  res.json(await storageReport());
});

export default router;
