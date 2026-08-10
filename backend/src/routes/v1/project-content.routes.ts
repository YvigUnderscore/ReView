// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { AssetType, TaskStatus, VersionStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { validate } from '../../middleware/validate';
import { requireScope } from '../../middleware/scope';
import { readPagination, pageArgs, paginate } from '../../lib/pagination';
import { assetSelect, taskSelect, versionSelect, toAsset, toTask, toVersion } from '../../lib/v1Resources';
import * as Ensure from '../../services/PipelineEnsureService';
import * as Resolve from '../../services/PipelineResolveService';
import { requireProject, refParam, actorOf, readQuery, listQuery } from './helpers';

/**
 * Contenu d'un projet qui ne suit pas la hiérarchie séquence → shot : les assets, puis
 * les vues transversales (toutes les tâches, toutes les versions). Un client de dailies
 * ou de synchronisation interroge celles-ci sans parcourir l'arbre.
 */
const router = Router();

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
