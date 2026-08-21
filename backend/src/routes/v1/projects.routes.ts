// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { ProjectStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { validate } from '../../middleware/validate';
import { requireScope } from '../../middleware/scope';
import { isGlobalManager } from '../../lib/projectRoles';
import { readPagination, pageArgs, paginate } from '../../lib/pagination';
import {
  projectSelect,
  sequenceSelect,
  shotSelect,
  toProject,
  toSequence,
  toShot,
} from '../../lib/v1Resources';
import * as Ensure from '../../services/PipelineEnsureService';
import * as Resolve from '../../services/PipelineResolveService';
import { requireProject, refParam, actorOf, listQuery } from './helpers';

/**
 * Projets et hiérarchie de tournage (API v1) : le projet, ses séquences, ses shots.
 * Filtrées et paginées, ces collections permettent à un client de peupler une interface
 * (un sélecteur de shot dans Maya) en un appel par niveau. Les assets et les vues
 * transversales vivent dans `project-content.routes`.
 *
 * Les créations sont des « ensure » : rejouables, elles convergent vers le même état.
 */
const router = Router();

// GET /api/v1/projects — projets accessibles au porteur
router.get(
  '/',
  requireScope('projects:read'),
  validate({ query: listQuery.extend({ status: z.nativeEnum(ProjectStatus).optional() }) }),
  async (req, res) => {
    const p = readPagination(req.query);
    const user = req.user!;
    // Portée transverse (aucun projet visé) : c'est le seul cas où le rôle global décide.
    const manager = isGlobalManager(user.role);
    const where = {
      deletedAt: null,
      ...(req.query.status ? { status: req.query.status as ProjectStatus } : {}),
      // Un token cantonné ne voit que son projet, même si son porteur est admin.
      ...(req.apiToken?.projectId ? { id: req.apiToken.projectId } : {}),
      ...(manager ? {} : { memberships: { some: { userId: user.id } } }),
    };
    const [rows, total] = await Promise.all([
      prisma.project.findMany({ where, orderBy: { name: 'asc' }, ...pageArgs(p), select: projectSelect }),
      prisma.project.count({ where }),
    ]);
    res.json(paginate(rows.map(toProject), total, p));
  },
);

// GET /api/v1/projects/:ref — détail (ref = identifiant, slug ou nom)
router.get('/:ref', requireScope('projects:read'), validate({ params: refParam }), async (req, res) => {
  res.json({ project: toProject(await requireProject(req, String(req.params.ref))) });
});

// ── Séquences ────────────────────────────────────────────────────────────────

router.get(
  '/:ref/sequences',
  requireScope('sequences:read'),
  validate({ params: refParam }),
  async (req, res) => {
    const project = await requireProject(req, String(req.params.ref));
    const rows = await prisma.sequence.findMany({
      where: { projectId: project.id, deletedAt: null },
      orderBy: [{ order: 'asc' }, { code: 'asc' }],
      select: sequenceSelect,
    });
    res.json({ sequences: rows.map(toSequence) });
  },
);

router.post(
  '/:ref/sequences',
  requireScope('sequences:write'),
  validate({
    params: refParam,
    body: z.object({
      code: z.string().trim().min(1).max(80),
      name: z.string().trim().min(1).max(160).optional(),
      order: z.number().int().optional(),
    }),
  }),
  async (req, res) => {
    const project = await requireProject(req, String(req.params.ref));
    const { entity, created } = await Ensure.ensureSequence(
      actorOf(req),
      project.id,
      req.body as Ensure.EnsureSequenceInput,
    );
    res.status(created ? 201 : 200).json({ sequence: toSequence(entity), created });
  },
);

// ── Shots ────────────────────────────────────────────────────────────────────

router.get(
  '/:ref/shots',
  requireScope('shots:read'),
  validate({
    params: refParam,
    query: listQuery.extend({ sequence: z.string().max(200).optional() }),
  }),
  async (req, res) => {
    const project = await requireProject(req, String(req.params.ref));
    const p = readPagination(req.query);
    // Filtre facultatif par séquence, désignée par son code (pas par son identifiant).
    const sequenceId = req.query.sequence
      ? (await Resolve.resolveSequence(project.id, String(req.query.sequence))).id
      : undefined;
    const where = {
      projectId: project.id,
      deletedAt: null,
      ...(sequenceId !== undefined ? { sequenceId } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.shot.findMany({
        where,
        orderBy: [{ order: 'asc' }, { code: 'asc' }],
        ...pageArgs(p),
        select: shotSelect,
      }),
      prisma.shot.count({ where }),
    ]);
    res.json(paginate(rows.map(toShot), total, p));
  },
);

router.post(
  '/:ref/shots',
  requireScope('shots:write'),
  validate({
    params: refParam,
    body: z.object({
      code: z.string().trim().min(1).max(80),
      name: z.string().trim().min(1).max(160).optional(),
      sequenceCode: z.string().trim().min(1).max(80).optional(),
      startFrame: z.number().int().optional(),
      endFrame: z.number().int().optional(),
      order: z.number().int().optional(),
    }),
  }),
  async (req, res) => {
    const project = await requireProject(req, String(req.params.ref));
    const { entity, created } = await Ensure.ensureShot(
      actorOf(req),
      project.id,
      req.body as Ensure.EnsureShotInput,
    );
    res.status(created ? 201 : 200).json({ shot: toShot(entity), created });
  },
);

export default router;
