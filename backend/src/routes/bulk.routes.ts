// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { TaskStatus, VersionStatus } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as BulkService from '../services/BulkService';
import * as AssignmentService from '../services/AssignmentService';
import { DELETE_DOMAINS } from '../services/BulkService';

/**
 * Actions groupées (13.C). Routeur fin : valide (Zod, max 200 ids) puis délègue au
 * `BulkService` qui revalide le RBAC par id. Monté sur `/api/bulk`.
 */
const router = Router();
router.use(authenticate);

const ids = z.array(z.number().int()).min(1).max(200);
const domainParam = z.object({ domain: z.enum(DELETE_DOMAINS) });

// POST /api/bulk/:domain/delete — mise à la corbeille en lot
router.post(
  '/:domain/delete',
  validate({ params: domainParam, body: z.object({ ids }) }),
  async (req, res) => {
    const { ids: list } = req.body as { ids: number[] };
    const count = await BulkService.bulkDelete(
      req.user!,
      req.params.domain as BulkService.DeleteDomain,
      list,
    );
    res.json({ count });
  },
);

// POST /api/bulk/:domain/restore — restauration en lot
router.post(
  '/:domain/restore',
  validate({ params: domainParam, body: z.object({ ids }) }),
  async (req, res) => {
    const { ids: list } = req.body as { ids: number[] };
    const count = await BulkService.bulkRestore(
      req.user!,
      req.params.domain as BulkService.DeleteDomain,
      list,
    );
    res.json({ count });
  },
);

// POST /api/bulk/:domain/purge — purge définitive en lot (DB + MinIO, irréversible)
router.post(
  '/:domain/purge',
  validate({ params: domainParam, body: z.object({ ids }) }),
  async (req, res) => {
    const { ids: list } = req.body as { ids: number[] };
    const count = await BulkService.bulkPurge(req.user!, req.params.domain as BulkService.DeleteDomain, list);
    res.json({ count });
  },
);

// PATCH /api/bulk/tasks — statut / réassignation en lot
router.patch(
  '/tasks',
  validate({
    body: z.object({
      ids,
      status: z.nativeEnum(TaskStatus).optional(),
      assigneeId: z.number().int().nullable().optional(),
    }),
  }),
  async (req, res) => {
    const {
      ids: taskIds,
      status,
      assigneeId,
    } = req.body as {
      ids: number[];
      status?: TaskStatus;
      assigneeId?: number | null;
    };
    // Ne transmet que les champs réellement fournis (l'assigné ne peut patcher que le statut).
    const patch: BulkService.BulkTaskPatch = {};
    if (status !== undefined) patch.status = status;
    if (assigneeId !== undefined) patch.assigneeId = assigneeId;
    const count = await BulkService.bulkPatchTasks(req.user!, taskIds, patch);
    res.json({ count });
  },
);

// PATCH /api/bulk/versions — changement de statut en lot
router.patch(
  '/versions',
  validate({ body: z.object({ ids, status: z.nativeEnum(VersionStatus) }) }),
  async (req, res) => {
    const { ids: versionIds, status } = req.body as { ids: number[]; status: VersionStatus };
    const count = await BulkService.bulkPatchVersions(req.user!, versionIds, status);
    res.json({ count });
  },
);

// PATCH /api/bulk/shots/move — déplacement de shots vers une séquence (null = hors séquence)
router.patch(
  '/shots/move',
  validate({ body: z.object({ ids, sequenceId: z.number().int().nullable() }) }),
  async (req, res) => {
    const { ids: shotIds, sequenceId } = req.body as { ids: number[]; sequenceId: number | null };
    const count = await BulkService.bulkMoveShots(req.user!, shotIds, sequenceId);
    res.json({ count });
  },
);

/**
 * PATCH /api/bulk/shots/status — statut d'une sélection de plans.
 *
 * `pipelineStatusId: null` retire le statut, comme au singulier. Le service revérifie
 * l'accès au projet et applique le statut plan par plan : la réponse dit combien ont
 * abouti et combien ont été refusés (verrou ShotGrid, projet archivé).
 */
router.patch(
  '/shots/status',
  validate({ body: z.object({ ids, pipelineStatusId: z.number().int().positive().nullable() }) }),
  async (req, res) => {
    const { ids: shotIds, pipelineStatusId } = req.body as {
      ids: number[];
      pipelineStatusId: number | null;
    };
    res.json(await BulkService.bulkPatchShotStatus(req.user!, shotIds, pipelineStatusId));
  },
);

/**
 * Assignation d'une sélection d'assets ou de plans.
 *
 * Une entité qu'on ne peut pas assigner (droits, projet archivé, aucune tâche) est
 * comptée à part plutôt que de faire échouer tout le lot : sur cinquante assets,
 * tout perdre pour un seul serait absurde.
 */
for (const holder of ['assets', 'shots'] as const) {
  router.patch(
    `/${holder}/assign`,
    validate({
      body: z.object({
        ids,
        userId: z.number().int().positive().nullable(),
        departmentIds: z.array(z.number().int().positive()).max(50).optional(),
      }),
    }),
    async (req, res) => {
      const result = await AssignmentService.assignMany(
        req.user!,
        holder === 'assets' ? 'asset' : 'shot',
        req.body.ids as number[],
        { userId: req.body.userId, departmentIds: req.body.departmentIds },
      );
      res.json(result);
    },
  );
}

// PATCH /api/bulk/assets/departments — cocher/décocher des étapes sur une sélection
router.patch(
  '/assets/departments',
  validate({
    body: z.object({
      ids,
      add: z.array(z.number().int().positive()).max(50).optional(),
      remove: z.array(z.number().int().positive()).max(50).optional(),
    }),
  }),
  async (req, res) => {
    const count = await BulkService.bulkAssetDepartments(req.user!, req.body.ids as number[], {
      add: req.body.add ?? [],
      remove: req.body.remove ?? [],
    });
    res.json({ count });
  },
);

export default router;
