// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireUser } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { prisma } from '../lib/prisma';
import { notFound } from '../lib/errors';
import { assertProjectManager } from '../lib/shotgridAccess';
import * as Config from '../services/shotgrid/ShotgridConfigService';
import { listForUi } from '../services/shotgrid/shotgridLinks';
import * as Sync from '../services/shotgrid/ShotgridSyncService';
import * as Journal from '../services/shotgrid/ShotgridSyncJournal';
import { buildDiff } from '../services/shotgrid/ShotgridDiffService';
import { resolveConflict } from '../services/shotgrid/ShotgridConflictService';
import { listImportableVersions, pullVersions } from '../services/shotgrid/ShotgridVersionSync';
import { SyncJournal } from '../services/shotgrid/ShotgridSyncJournal';

/** Syncs, journal, comparison, and on-demand import of publishes. */
const router = Router();
router.use(authenticate);

const projectParam = z.object({ projectId: z.coerce.number().int().positive() });
const runParam = z.object({ runId: z.coerce.number().int().positive() });

/** Starts a sync. `full` takes everything, `reconcile` the catch-up window. */
router.post(
  '/projects/:projectId/sync',
  validate({
    params: projectParam,
    body: z
      .object({
        kind: z.enum(['full', 'reconcile']).default('full'),
        withMedia: z.boolean().optional(),
      })
      .prefault({ kind: 'full' }),
  }),
  async (req, res) => {
    const projectId = Number(req.params.projectId);
    await assertProjectManager(requireUser(req), projectId);
    const result =
      req.body.kind === 'reconcile'
        ? await Sync.runReconcile(projectId)
        : await Sync.runSync(projectId, {
            kind: 'full',
            triggeredById: requireUser(req).id,
            withMedia: req.body.withMedia,
          });
    res.json({ result });
  },
);

router.get('/projects/:projectId/runs', validate({ params: projectParam }), async (req, res) => {
  const projectId = Number(req.params.projectId);
  await assertProjectManager(requireUser(req), projectId, { allowMembers: true });
  const conn = await Config.getConnectionOrThrow(projectId);
  res.json({
    runs: await Journal.listRuns(conn.id),
    openConflicts: await Journal.listOpenConflicts(conn.id),
  });
});

const logsQuery = z.object({
  level: z.enum(['info', 'warn', 'error', 'conflict']).optional(),
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().min(1).max(500).default(200),
});
router.get(
  '/runs/:runId/logs',
  validate({
    params: runParam,
    query: logsQuery,
  }),
  async (req, res) => {
    const runId = Number(req.params.runId);
    const run = await prisma.shotgridSyncRun.findUnique({
      where: { id: runId },
      include: { connection: { select: { projectId: true } } },
    });
    if (!run) throw notFound('Run not found');
    await assertProjectManager(requireUser(req), run.connection.projectId, { allowMembers: true });
    // Re-read: the coercion of `validate` does not persist on `req.query` under Express 5.
    const { level, skip, take } = logsQuery.parse(req.query);
    res.json(await Journal.listLogs(runId, { level, skip, take }));
  },
);

/** Resolution of a conflict left pending (manual policy). */
/**
 * Resolution of a conflict. The journal does not merely classify it: the decision is applied. "ShotGrid"
 * re-reads the remote entity and writes it over the local one; "ReView" pushes the local value to the site.
 * Marking the row resolved without doing anything would leave the gap in place, which is worse than
 * offering nothing.
 */
router.post(
  '/logs/:logId/resolve',
  validate({
    params: z.object({ logId: z.coerce.number().int().positive() }),
    body: z.object({ resolution: z.enum(['sg', 'review']) }),
  }),
  async (req, res) => {
    const logId = Number(req.params.logId);
    const log = await prisma.shotgridSyncLog.findUnique({
      where: { id: logId },
      include: { run: { include: { connection: { select: { projectId: true } } } } },
    });
    if (!log) throw notFound('Log entry not found');
    await assertProjectManager(requireUser(req), log.run.connection.projectId);

    const applied = await resolveConflict(
      log.run.connection.projectId,
      log,
      req.body.resolution,
      requireUser(req).id,
    );
    await prisma.shotgridSyncLog.update({
      where: { id: logId },
      data: { resolvedAt: new Date(), resolution: req.body.resolution },
    });
    res.json({ ok: true, applied });
  },
);

/**
 * The project's matches: the interface draws direct links to the ShotGrid records from them.
 * One request per project rather than one per displayed card.
 */
router.get('/projects/:projectId/links', validate({ params: projectParam }), async (req, res) => {
  const projectId = Number(req.params.projectId);
  await assertProjectManager(requireUser(req), projectId, { allowMembers: true });
  const conn = await Config.getConnection(projectId);
  if (!conn?.active) return res.json({ links: [] });
  res.json({ links: await listForUi(conn.id) });
});

/**
 * Comparison of both sides. No write: it serves to decide, not to correct.
 */
router.get('/projects/:projectId/diff', validate({ params: projectParam }), async (req, res) => {
  const projectId = Number(req.params.projectId);
  await assertProjectManager(requireUser(req), projectId, { allowMembers: true });
  res.json({ diff: await buildDiff(projectId) });
});

/** Available ShotGrid publishes, imported or not. */
router.get('/projects/:projectId/versions', validate({ params: projectParam }), async (req, res) => {
  const projectId = Number(req.params.projectId);
  await assertProjectManager(requireUser(req), projectId, { allowMembers: true });
  const ctx = await Config.openConnection(projectId, { verifyProject: false });
  const journal = await SyncJournal.start(ctx.connection.id, 'diff');
  try {
    const versions = await listImportableVersions({
      ...ctx,
      journal,
      scope: { sgProjectId: ctx.connection.sgProjectId, sgProjectName: ctx.connection.sgProjectName },
    });
    await journal.finish('ok');
    res.json({ versions });
  } catch (err) {
    await journal.fail(err);
    throw err;
  }
});

/** On-demand import: the selection overrides the status filter. */
router.post(
  '/projects/:projectId/import-versions',
  validate({
    params: projectParam,
    body: z.object({ sgIds: z.array(z.number().int().positive()).min(1).max(200) }),
  }),
  async (req, res) => {
    const projectId = Number(req.params.projectId);
    await assertProjectManager(requireUser(req), projectId);
    const ctx = await Config.openConnection(projectId);
    const journal = await SyncJournal.start(ctx.connection.id, 'import-versions', requireUser(req).id);
    try {
      await pullVersions(
        {
          ...ctx,
          journal,
          scope: { sgProjectId: ctx.connection.sgProjectId, sgProjectName: ctx.connection.sgProjectName },
        },
        { onlySgIds: req.body.sgIds, withMedia: true },
      );
      await journal.finish('ok');
      res.json({ runId: journal.runId, totals: journal.totals });
    } catch (err) {
      await journal.fail(err);
      throw err;
    }
  },
);

export default router;
