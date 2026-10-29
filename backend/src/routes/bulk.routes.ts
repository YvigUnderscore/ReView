// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { TaskStatus, VersionStatus } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as BulkService from '../services/BulkService';
import * as AssignmentService from '../services/AssignmentService';
import * as ReviewDecisionService from '../services/ReviewDecisionService';
import { DELETE_DOMAINS } from '../services/BulkService';

/**
 * Bulk actions (13.C). Thin router: validates (Zod, max 200 ids) then delegates to `BulkService`,
 * which re-checks the RBAC per id. Mounted on `/api/bulk`.
 */
const router = Router();
router.use(authenticate);

const ids = z.array(z.number().int()).min(1).max(200);
const domainParam = z.object({ domain: z.enum(DELETE_DOMAINS) });

// POST /api/bulk/:domain/delete — bulk move to the trash
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

// POST /api/bulk/:domain/restore — bulk restore
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

// POST /api/bulk/:domain/purge — bulk permanent purge (DB + MinIO, irreversible)
router.post(
  '/:domain/purge',
  validate({ params: domainParam, body: z.object({ ids }) }),
  async (req, res) => {
    const { ids: list } = req.body as { ids: number[] };
    const count = await BulkService.bulkPurge(req.user!, req.params.domain as BulkService.DeleteDomain, list);
    res.json({ count });
  },
);

// PATCH /api/bulk/tasks — bulk status / reassignment
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
    // Only forwards the fields actually provided (the assignee can only patch the status).
    const patch: BulkService.BulkTaskPatch = {};
    if (status !== undefined) patch.status = status;
    if (assigneeId !== undefined) patch.assigneeId = assigneeId;
    const count = await BulkService.bulkPatchTasks(req.user!, taskIds, patch);
    res.json({ count });
  },
);

// PATCH /api/bulk/versions — bulk status change
router.patch(
  '/versions',
  validate({ body: z.object({ ids, status: z.nativeEnum(VersionStatus) }) }),
  async (req, res) => {
    const { ids: versionIds, status } = req.body as { ids: number[]; status: VersionStatus };
    const count = await BulkService.bulkPatchVersions(req.user!, versionIds, status);
    res.json({ count });
  },
);

/**
 * PATCH /api/bulk/versions/decision: review decision on a selection (Phase 31).
 *
 * The selection on the Reviews page readily spans several projects: the service therefore re-checks
 * supervision and the project vocabulary project by project, and counts the refusals.
 */
router.patch(
  '/versions/decision',
  validate({
    body: z.object({ ids, statusId: z.number().int().positive(), comment: z.string().max(2000).optional() }),
  }),
  async (req, res) => {
    const b = req.body as { ids: number[]; statusId: number; comment?: string };
    res.json(await ReviewDecisionService.decideMany(req.user!, b.ids, b.statusId, b.comment));
  },
);

// PATCH /api/bulk/shots/move — moves shots to a sequence (null = outside any sequence)
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
 * PATCH /api/bulk/shots/status: status of a selection of shots.
 *
 * `pipelineStatusId: null` removes the status, as in the single variant. The service re-checks project
 * access and applies the status shot by shot: the response says how many succeeded and how many were
 * refused (ShotGrid lock, archived project).
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
 * Assignment of a selection of assets or shots.
 *
 * An entity that cannot be assigned (rights, archived project, no task) is counted separately rather
 * than failing the whole batch: out of fifty assets, losing everything for a single one would be absurd.
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

// PATCH /api/bulk/assets/departments — tick or untick steps on a selection
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
