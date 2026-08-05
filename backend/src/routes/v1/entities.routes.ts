// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { Role, TaskStatus, TaskType, VersionStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { validate } from '../../middleware/validate';
import { requireScope } from '../../middleware/scope';
import { forbidden, notFound } from '../../lib/errors';
import { assertProjectWritable } from '../../lib/projectGuard';
import { assertCanContribute } from '../../lib/projectRoles';
import {
  shotSelect,
  assetSelect,
  taskSelect,
  versionSelect,
  mediaSelect,
  toShot,
  toAsset,
  toTask,
  toVersion,
  toMedia,
} from '../../lib/v1Resources';
import * as Ensure from '../../services/PipelineEnsureService';
import * as VersionService from '../../services/VersionService';
import * as ReviewDecisionService from '../../services/ReviewDecisionService';
import * as ApiEventService from '../../services/ApiEventService';
import {
  idParam,
  actorOf,
  requireShotProject,
  requireAssetProject,
  requireTaskProject,
  requireVersionProject,
} from './helpers';

/**
 * Entités du pipeline adressées par identifiant (API v1) : shots, assets, tâches,
 * versions et leurs médias. Ces routes prolongent celles du projet — un client qui a
 * résolu un chemin repart d'ici sans repasser par la hiérarchie.
 */
const router = Router();

// ── Shots ────────────────────────────────────────────────────────────────────

router.get('/shots/:id', requireScope('shots:read'), validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  await requireShotProject(req, id);
  const shot = await prisma.shot.findUnique({ where: { id }, select: shotSelect });
  if (!shot) throw notFound('Shot introuvable');
  res.json({ shot: toShot(shot) });
});

router.get(
  '/shots/:id/tasks',
  requireScope('tasks:read'),
  validate({ params: idParam }),
  async (req, res) => {
    const id = Number(req.params.id);
    await requireShotProject(req, id);
    const rows = await prisma.task.findMany({
      where: { shotId: id },
      orderBy: { order: 'asc' },
      select: taskSelect,
    });
    res.json({ tasks: rows.map(toTask) });
  },
);

router.post(
  '/shots/:id/tasks',
  requireScope('tasks:write'),
  validate({
    params: idParam,
    body: z.object({
      name: z.string().trim().min(1).max(160),
      type: z.nativeEnum(TaskType).optional(),
    }),
  }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await requireShotProject(req, id);
    const { entity, created } = await Ensure.ensureTask(
      actorOf(req),
      projectId,
      { shotId: id },
      req.body as Ensure.EnsureTaskInput,
    );
    if (created) {
      ApiEventService.publish('task.created', {
        projectId,
        entityType: 'task',
        entityId: entity.id,
        actorId: req.user!.id,
        payload: { task: toTask(entity) },
      });
    }
    res.status(created ? 201 : 200).json({ task: toTask(entity), created });
  },
);

// ── Assets ───────────────────────────────────────────────────────────────────

router.get('/assets/:id', requireScope('assets:read'), validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  await requireAssetProject(req, id);
  const asset = await prisma.asset.findUnique({ where: { id }, select: assetSelect });
  if (!asset) throw notFound('Asset introuvable');
  res.json({ asset: toAsset(asset) });
});

router.get(
  '/assets/:id/tasks',
  requireScope('tasks:read'),
  validate({ params: idParam }),
  async (req, res) => {
    const id = Number(req.params.id);
    await requireAssetProject(req, id);
    const rows = await prisma.task.findMany({
      where: { assetId: id },
      orderBy: { order: 'asc' },
      select: taskSelect,
    });
    res.json({ tasks: rows.map(toTask) });
  },
);

router.post(
  '/assets/:id/tasks',
  requireScope('tasks:write'),
  validate({
    params: idParam,
    body: z.object({
      name: z.string().trim().min(1).max(160),
      type: z.nativeEnum(TaskType).optional(),
    }),
  }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await requireAssetProject(req, id);
    const { entity, created } = await Ensure.ensureTask(
      actorOf(req),
      projectId,
      { assetId: id },
      req.body as Ensure.EnsureTaskInput,
    );
    if (created) {
      ApiEventService.publish('task.created', {
        projectId,
        entityType: 'task',
        entityId: entity.id,
        actorId: req.user!.id,
        payload: { task: toTask(entity) },
      });
    }
    res.status(created ? 201 : 200).json({ task: toTask(entity), created });
  },
);

// ── Tâches ───────────────────────────────────────────────────────────────────

router.get('/tasks/:id', requireScope('tasks:read'), validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  await requireTaskProject(req, id);
  const task = await prisma.task.findUnique({ where: { id }, select: taskSelect });
  if (!task) throw notFound('Tâche introuvable');
  res.json({ task: toTask(task) });
});

// PATCH /api/v1/tasks/:id — statut et assignation, le minimum qu'un pipeline pilote
router.patch(
  '/tasks/:id',
  requireScope('tasks:write'),
  validate({
    params: idParam,
    body: z.object({
      status: z.nativeEnum(TaskStatus).optional(),
      assigneeId: z.number().int().positive().nullable().optional(),
      dueDate: z.coerce.date().nullable().optional(),
    }),
  }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await requireTaskProject(req, id);
    await assertProjectWritable(projectId);
    await assertCanContribute(req.user!.id, req.user!.role, projectId);

    const body = req.body as { status?: TaskStatus; assigneeId?: number | null; dueDate?: Date | null };
    const before = await prisma.task.findUnique({ where: { id }, select: { status: true } });
    const task = await prisma.task.update({
      where: { id },
      data: {
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.assigneeId !== undefined ? { assigneeId: body.assigneeId } : {}),
        ...(body.dueDate !== undefined ? { dueDate: body.dueDate } : {}),
      },
      select: taskSelect,
    });

    const view = toTask(task);
    // Le changement de statut est l'événement que suivent les tableaux de production :
    // on le distingue d'une mise à jour quelconque pour éviter aux clients de comparer.
    if (body.status !== undefined && before && before.status !== body.status) {
      ApiEventService.publish('task.status_changed', {
        projectId,
        entityType: 'task',
        entityId: id,
        actorId: req.user!.id,
        payload: { task: view, from: before.status, to: body.status },
      });
    }
    if (body.assigneeId !== undefined) {
      ApiEventService.publish('task.assigned', {
        projectId,
        entityType: 'task',
        entityId: id,
        actorId: req.user!.id,
        payload: { task: view, assigneeId: body.assigneeId },
      });
    }
    ApiEventService.publish('task.updated', {
      projectId,
      entityType: 'task',
      entityId: id,
      actorId: req.user!.id,
      payload: { task: view },
    });
    res.json({ task: view });
  },
);

router.get(
  '/tasks/:id/versions',
  requireScope('versions:read'),
  validate({ params: idParam }),
  async (req, res) => {
    const id = Number(req.params.id);
    await requireTaskProject(req, id);
    const rows = await prisma.version.findMany({
      where: { taskId: id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: versionSelect,
    });
    res.json({ versions: rows.map(toVersion) });
  },
);

router.post(
  '/tasks/:id/versions',
  requireScope('versions:write'),
  validate({
    params: idParam,
    body: z.object({
      name: z.string().trim().min(1).max(60).optional(),
      reuseExisting: z.boolean().optional(),
    }),
  }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await requireTaskProject(req, id);
    const { entity, created } = await Ensure.ensureVersion(
      actorOf(req),
      projectId,
      { taskId: id },
      req.body as Ensure.EnsureVersionInput,
    );
    if (created) {
      ApiEventService.publish('version.created', {
        projectId,
        entityType: 'version',
        entityId: entity.id,
        actorId: req.user!.id,
        payload: { version: toVersion(entity) },
      });
    }
    res.status(created ? 201 : 200).json({ version: toVersion(entity), created });
  },
);

// ── Versions ─────────────────────────────────────────────────────────────────

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
    if (!version) throw notFound('Version introuvable');
    res.json({ version: toVersion(version) });
  },
);

// PATCH /api/v1/versions/:id — renommage et statut (publication : superviseur+)
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
    // Le service porte les règles de publication (verrou, rôle) : on ne les redéfinit pas.
    const body = req.body as VersionService.UpdateVersionInput;
    const version = await VersionService.update(req.user!, projectId, id, body);
    if (body.status === VersionStatus.PUBLISHED) {
      ApiEventService.publish('version.published', {
        projectId,
        entityType: 'version',
        entityId: id,
        actorId: req.user!.id,
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

// POST /api/v1/versions/:id/decision — décision de review (superviseur+)
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
    if (req.user!.role !== Role.ADMIN && req.user!.role !== Role.SUPERVISOR) {
      throw forbidden('Décision réservée aux superviseurs');
    }
    const { statusId, comment } = req.body as { statusId: number; comment?: string };
    const decision = await ReviewDecisionService.decide(req.user!, projectId, id, statusId, comment);
    res.status(201).json({ decision });
  },
);

export default router;
