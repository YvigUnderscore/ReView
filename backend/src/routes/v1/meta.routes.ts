// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import {
  AssetType,
  MediaKind,
  MediaStatus,
  ProjectStatus,
  Role,
  TaskStatus,
  TaskType,
  VersionStatus,
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { validate } from '../../middleware/validate';
import { requireScope, assertTokenProject } from '../../middleware/scope';
import { assertProjectAccess } from '../../middleware/rbac';
import { expandScopes, ALL_SCOPES } from '../../lib/apiScopes';
import { API_EVENTS } from '../../lib/webhooks';
import { formatPipelinePath, parsePipelinePath } from '../../lib/pipelinePath';
import { toProject } from '../../lib/v1Resources';
import * as Resolve from '../../services/PipelineResolveService';

/**
 * Points d'entrée de découverte de l'API v1.
 *
 * Un client de pipeline démarre par ici : il apprend ce que son token peut faire (`/me`),
 * quelles valeurs le studio accepte (`/schema` — types de tâches, statuts de review
 * personnalisés…) et comment traduire un nom en entité (`/resolve`). Sans cela, chaque
 * intégration coderait en dur des énumérations qui divergent au premier changement.
 */
const router = Router();

// GET /api/v1 — index : version, capacités, chemins utiles
router.get('/', (_req, res) => {
  res.json({
    name: 'ReView API',
    version: 'v1',
    documentation: '/api/docs',
    openapi: '/api/openapi.json',
    capabilities: {
      pathResolution: true,
      idempotency: 'Idempotency-Key',
      events: '/api/v1/events',
      publish: '/api/v1/publish',
    },
  });
});

// GET /api/v1/me — identité effective et pouvoirs réels du jeton présenté
router.get('/me', async (req, res) => {
  const user = req.user!;
  const memberships = await prisma.projectMembership.findMany({
    where: { userId: user.id },
    select: { projectId: true, role: true },
  });
  const isGlobalManager = user.role === Role.ADMIN || user.role === Role.SUPERVISOR;
  res.json({
    user: { id: user.id, email: user.email, role: user.role },
    auth: req.apiToken
      ? {
          kind: 'api_token',
          tokenId: req.apiToken.id,
          scopes: [...expandScopes(req.apiToken.scopes)].sort(),
          projectId: req.apiToken.projectId ?? null,
        }
      : { kind: 'session', scopes: null, projectId: null },
    // Un manager global voit tous les projets : la liste des adhésions serait trompeuse.
    projects: isGlobalManager ? 'all' : memberships,
  });
});

// GET /api/v1/schema — valeurs acceptées par cette instance (enums + statuts du studio)
router.get('/schema', requireScope('projects:read'), async (_req, res) => {
  const reviewStatuses = await prisma.reviewStatus.findMany({
    orderBy: { order: 'asc' },
    select: { id: true, name: true, color: true, isApproval: true, isRetake: true, isDefault: true },
  });
  res.json({
    enums: {
      projectStatus: Object.values(ProjectStatus),
      assetType: Object.values(AssetType),
      taskType: Object.values(TaskType),
      taskStatus: Object.values(TaskStatus),
      versionStatus: Object.values(VersionStatus),
      mediaKind: Object.values(MediaKind),
      mediaStatus: Object.values(MediaStatus),
      role: Object.values(Role),
    },
    // Statuts de review propres au studio (Phase 31) : ce sont eux qu'une décision référence.
    reviewStatuses,
    scopes: ALL_SCOPES,
    events: API_EVENTS,
  });
});

// GET /api/v1/resolve?path=PROJ/SQ010/SH0100/anim — chemin → entités
router.get(
  '/resolve',
  requireScope('projects:read'),
  validate({ query: z.object({ path: z.string().min(1).max(1200) }) }),
  async (req, res) => {
    const resolved = await Resolve.resolvePath(String(req.query.path));
    await assertProjectAccess(req, resolved.projectId);
    assertTokenProject(req, resolved.projectId);
    res.json({
      kind: resolved.kind,
      path: formatPipelinePath(parsePipelinePath(String(req.query.path))),
      project: toProject(resolved.project),
      sequence: resolved.sequence ?? null,
      shot: resolved.shot ?? null,
      asset: resolved.asset ?? null,
      task: resolved.task ?? null,
      version: resolved.version ?? null,
    });
  },
);

export default router;
