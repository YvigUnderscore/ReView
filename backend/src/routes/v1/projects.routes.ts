// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { AssetType, ProjectStatus, Role, TaskStatus, VersionStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { validate } from '../../middleware/validate';
import { requireScope } from '../../middleware/scope';
import { readPagination, pageArgs, paginate } from '../../lib/pagination';
import {
  projectSelect,
  sequenceSelect,
  shotSelect,
  assetSelect,
  taskSelect,
  versionSelect,
  toProject,
  toSequence,
  toShot,
  toAsset,
  toTask,
  toVersion,
} from '../../lib/v1Resources';
import * as Ensure from '../../services/PipelineEnsureService';
import * as Resolve from '../../services/PipelineResolveService';
import { requireProject, refParam, actorOf, readQuery } from './helpers';

/**
 * Projets et leur contenu (API v1). Toutes les collections d'un projet sont accessibles
 * ici, filtrées et paginées, pour qu'un client puisse peupler une interface (un
 * sélecteur de shot dans Maya) en un appel par niveau.
 *
 * Les créations sont des « ensure » : rejouables, elles convergent vers le même état.
 */
const router = Router();

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(100),
  sort: z.string().max(40).optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});

// GET /api/v1/projects — projets accessibles au porteur
router.get(
  '/',
  requireScope('projects:read'),
  validate({ query: listQuery.extend({ status: z.nativeEnum(ProjectStatus).optional() }) }),
  async (req, res) => {
    const p = readPagination(req.query);
    const user = req.user!;
    const isGlobalManager = user.role === Role.ADMIN || user.role === Role.SUPERVISOR;
    const where = {
      deletedAt: null,
      ...(req.query.status ? { status: req.query.status as ProjectStatus } : {}),
      // Un token cantonné ne voit que son projet, même si son porteur est admin.
      ...(req.apiToken?.projectId ? { id: req.apiToken.projectId } : {}),
      ...(isGlobalManager ? {} : { memberships: { some: { userId: user.id } } }),
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

// ── Assets ───────────────────────────────────────────────────────────────────

router.get(
  '/:ref/assets',
  requireScope('assets:read'),
  validate({
    params: refParam,
    query: listQuery.extend({ type: z.nativeEnum(AssetType).optional() }),
  }),
  async (req, res) => {
    const project = await requireProject(req, String(req.params.ref));
    const p = readPagination(req.query);
    const where = {
      projectId: project.id,
      deletedAt: null,
      ...(req.query.type ? { type: req.query.type as AssetType } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.asset.findMany({ where, orderBy: { name: 'asc' }, ...pageArgs(p), select: assetSelect }),
      prisma.asset.count({ where }),
    ]);
    res.json(paginate(rows.map(toAsset), total, p));
  },
);

router.post(
  '/:ref/assets',
  requireScope('assets:write'),
  validate({
    params: refParam,
    body: z.object({
      name: z.string().trim().min(1).max(160),
      type: z.nativeEnum(AssetType).optional(),
      description: z.string().trim().max(2000).optional(),
    }),
  }),
  async (req, res) => {
    const project = await requireProject(req, String(req.params.ref));
    const { entity, created } = await Ensure.ensureAsset(
      actorOf(req),
      project.id,
      req.body as Ensure.EnsureAssetInput,
    );
    res.status(created ? 201 : 200).json({ asset: toAsset(entity), created });
  },
);

// ── Tâches et versions du projet (vues transversales) ────────────────────────

// GET /api/v1/projects/:ref/tasks — toutes les tâches du projet, filtrables
router.get(
  '/:ref/tasks',
  requireScope('tasks:read'),
  validate({
    params: refParam,
    query: listQuery.extend({
      status: z.nativeEnum(TaskStatus).optional(),
      assigneeId: z.coerce.number().int().positive().optional(),
      shot: z.string().max(200).optional(),
      asset: z.string().max(200).optional(),
    }),
  }),
  async (req, res) => {
    const project = await requireProject(req, String(req.params.ref));
    const p = readPagination(req.query);
    const q = req.query as { status?: TaskStatus; assigneeId?: number; shot?: string; asset?: string };
    const shotId = q.shot ? (await Resolve.resolveShot(project.id, q.shot)).id : undefined;
    const assetId = q.asset ? (await Resolve.resolveAsset(project.id, q.asset)).id : undefined;
    const where = {
      OR: [{ shot: { projectId: project.id } }, { asset: { projectId: project.id } }],
      ...(q.status ? { status: q.status } : {}),
      ...(q.assigneeId ? { assigneeId: Number(q.assigneeId) } : {}),
      ...(shotId !== undefined ? { shotId } : {}),
      ...(assetId !== undefined ? { assetId } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.task.findMany({ where, orderBy: { id: 'asc' }, ...pageArgs(p), select: taskSelect }),
      prisma.task.count({ where }),
    ]);
    res.json(paginate(rows.map(toTask), total, p));
  },
);

const versionsQuery = listQuery.extend({
  status: z.nativeEnum(VersionStatus).optional(),
  published: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

// GET /api/v1/projects/:ref/versions — versions du projet (dailies, synchro externe)
router.get(
  '/:ref/versions',
  requireScope('versions:read'),
  validate({ params: refParam, query: versionsQuery }),
  async (req, res) => {
    const project = await requireProject(req, String(req.params.ref));
    const p = readPagination(req.query);
    // Relecture typée : sans elle, `published=false` resterait la chaîne « false ».
    const q = readQuery(versionsQuery, req);
    const where = {
      deletedAt: null,
      ...(q.status ? { status: q.status } : {}),
      ...(q.published !== undefined ? { published: q.published } : {}),
      OR: [
        { asset: { projectId: project.id } },
        { task: { shot: { projectId: project.id } } },
        { task: { asset: { projectId: project.id } } },
      ],
    };
    const [rows, total] = await Promise.all([
      prisma.version.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...pageArgs(p),
        select: versionSelect,
      }),
      prisma.version.count({ where }),
    ]);
    res.json(paginate(rows.map(toVersion), total, p));
  },
);

export default router;
