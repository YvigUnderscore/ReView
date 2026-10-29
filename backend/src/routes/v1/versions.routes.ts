// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { Role, VersionStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { validate } from '../../middleware/validate';
import { requireScope } from '../../middleware/scope';
import { forbidden, notFound } from '../../lib/errors';
import { versionSelect, mediaSelect, toVersion, toMedia } from '../../lib/v1Resources';
import * as VersionService from '../../services/VersionService';
import * as ReviewDecisionService from '../../services/ReviewDecisionService';
import * as ApiEventService from '../../services/ApiEventService';
import { idParam, requireVersionProject } from './helpers';
import { requireUser } from '../../middleware/auth';

/**
 * Versions in API v1: the version itself, its media, and the review decision that closes it.
 * Publication rules live in VersionService: this route only calls them, so that an API client and
 * the web UI obey the same lock.
 */
const router = Router();

router.get(
  '/versions/:id',
  requireScope('versions:read'),
  validate({ params: idParam }),
  async (req, res) => {
    const id = Number(req.params.id);
    await requireVersionProject(req, id);
    const version = await prisma.version.findUnique({
      where: { id },
      select: { ...versionSelect, media: { where: { deletedAt: null }, select: mediaSelect } },
    });
    if (!version) throw notFound('Version not found');
    res.json({ version: toVersion(version) });
  },
);

// PATCH /api/v1/versions/:id: rename and status (publication: supervisor+)
router.patch(
  '/versions/:id',
  requireScope('versions:write'),
  validate({
    params: idParam,
    body: z.object({
      name: z.string().trim().min(1).max(60).optional(),
      status: z.nativeEnum(VersionStatus).optional(),
    }),
  }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await requireVersionProject(req, id);
    // The service carries the publication rules (lock, role): they are not redefined here.
    const body = req.body as VersionService.UpdateVersionInput;
    const version = await VersionService.update(requireUser(req), projectId, id, body);
    if (body.status === VersionStatus.PUBLISHED) {
      ApiEventService.publish('version.published', {
        projectId,
        entityType: 'version',
        entityId: id,
        actorId: requireUser(req).id,
        payload: { versionId: id, name: version.name },
      });
    }
    res.json({ version });
  },
);

router.get(
  '/versions/:id/media',
  requireScope('media:read'),
  validate({ params: idParam }),
  async (req, res) => {
    const id = Number(req.params.id);
    await requireVersionProject(req, id);
    const rows = await prisma.mediaObject.findMany({
      where: { versionId: id, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: mediaSelect,
    });
    res.json({ media: rows.map(toMedia) });
  },
);

// POST /api/v1/versions/:id/decision: review decision (supervisor+)
router.post(
  '/versions/:id/decision',
  requireScope('versions:write'),
  validate({
    params: idParam,
    body: z.object({
      statusId: z.number().int().positive(),
      comment: z.string().max(2000).optional(),
    }),
  }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await requireVersionProject(req, id);
    if (requireUser(req).role !== Role.ADMIN && requireUser(req).role !== Role.SUPERVISOR) {
      throw forbidden('Supervisors only');
    }
    const { statusId, comment } = req.body as { statusId: number; comment?: string };
    const decision = await ReviewDecisionService.decide(requireUser(req), projectId, id, statusId, comment);
    res.status(201).json({ decision });
  },
);

export default router;
