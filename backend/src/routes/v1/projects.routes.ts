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
import { resolveProjectSettingsById } from '../../lib/projectSettings';
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
import { requireUser } from '../../middleware/auth';

/**
 * Projects and the shooting hierarchy (API v1): the project, its sequences, its shots.
 * Filtered and paginated, these collections let a client populate a UI (a shot picker in Maya) in
 * one call per level. Assets and cross-cutting views live in `project-content.routes`.
 *
 * Creations are "ensure" operations: replayable, they converge to the same state.
 */
const router = Router();

// GET /api/v1/projects: projects accessible to the bearer
router.get(
  '/',
  requireScope('projects:read'),
  validate({ query: listQuery.extend({ status: z.nativeEnum(ProjectStatus).optional() }) }),
  async (req, res) => {
    const p = readPagination(req.query);
    const user = requireUser(req);
    // Cross-cutting scope (no target project): the only case where the global role decides.
    const manager = isGlobalManager(user.role);
    const where = {
      deletedAt: null,
      ...(req.query.status ? { status: req.query.status as ProjectStatus } : {}),
      // A scoped token only sees its own project, even if its bearer is an admin.
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

// GET /api/v1/projects/:ref: detail (ref = identifier, slug or name)
router.get('/:ref', requireScope('projects:read'), validate({ params: refParam }), async (req, res) => {
  res.json({ project: toProject(await requireProject(req, String(req.params.ref))) });
});

/**
 * GET /api/v1/projects/:ref/settings: the project's rules, with studio inheritance resolved.
 *
 * These are what a publication must know BEFORE sending anything: the naming convention (`naming`),
 * which can refuse a badly named file; the expected resolution and frame rate; and the brief rule
 * (`reviewRequest`), which decides whether tagging a reviewer requires writing what they must look
 * at, and over how many characters. Without this route a DCC discovered the rule by being refused.
 *
 * The returned values are the EFFECTIVE values: what the project inherits from the studio is already
 * merged in, so an integrator does not have to compose two levels.
 */
router.get(
  '/:ref/settings',
  requireScope('projects:read'),
  validate({ params: refParam }),
  async (req, res) => {
    const project = await requireProject(req, String(req.params.ref));
    const settings = await resolveProjectSettingsById(project.id);
    res.json({
      projectId: project.id,
      startFrame: project.startFrame,
      settings,
    });
  },
);

// ── Sequences ────────────────────────────────────────────────────────────────

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
    // Optional sequence filter, designated by its code (not by its identifier).
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
