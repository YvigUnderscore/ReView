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
import { isGlobalManager } from '../../lib/projectRoles';
import { API_EVENTS } from '../../lib/webhooks';
import { formatPipelinePath, parsePipelinePath } from '../../lib/pipelinePath';
import { toProject } from '../../lib/v1Resources';
import * as Resolve from '../../services/PipelineResolveService';

/**
 * Discovery entry points of API v1.
 *
 * A pipeline client starts here: it learns what its token can do (`/me`), which values the studio
 * accepts (`/schema`: task types, custom review statuses...) and how to translate a name into an
 * entity (`/resolve`). Without this, each integration would hard-code enumerations that diverge at
 * the first change.
 */
const router = Router();

// GET /api/v1: index: version, capabilities, useful paths
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
      // Read paths: a tool discovers here that it can fetch a file.
      latest: '/api/v1/latest',
      mediaUrl: '/api/v1/media/{id}/url',
    },
  });
});

// GET /api/v1/me: effective identity and real powers of the presented token
router.get('/me', async (req, res) => {
  const user = req.user!;
  const memberships = await prisma.projectMembership.findMany({
    where: { userId: user.id },
    select: { projectId: true, role: true },
  });
  // Cross-cutting scope (no target project): the only case where the global role decides.
  const manager = isGlobalManager(user.role);
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
    // A global manager sees all projects: a membership list would be misleading.
    projects: manager ? 'all' : memberships,
  });
});

// GET /api/v1/schema: values accepted by this instance (enums and studio statuses)
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
    // Studio-specific review statuses (Phase 31): these are what a decision references.
    reviewStatuses,
    scopes: ALL_SCOPES,
    events: API_EVENTS,
  });
});

// GET /api/v1/resolve?path=PROJ/SQ010/SH0100/anim: path to entities
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
