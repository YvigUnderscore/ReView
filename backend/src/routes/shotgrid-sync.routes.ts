// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { prisma } from '../lib/prisma';
import { notFound } from '../lib/errors';
import { assertProjectManager } from '../lib/shotgridAccess';
import * as Config from '../services/shotgrid/ShotgridConfigService';
import * as Sync from '../services/shotgrid/ShotgridSyncService';
import * as Journal from '../services/shotgrid/ShotgridSyncJournal';
import { buildDiff } from '../services/shotgrid/ShotgridDiffService';
import { resolveConflict } from '../services/shotgrid/ShotgridConflictService';
import { listImportableVersions, pullVersions } from '../services/shotgrid/ShotgridVersionSync';
import { SyncJournal } from '../services/shotgrid/ShotgridSyncJournal';

/** Synchronisations, journal, comparaison et import de publishes à la carte. */
const router = Router();
router.use(authenticate);

const projectParam = z.object({ projectId: z.coerce.number().int().positive() });
const runParam = z.object({ runId: z.coerce.number().int().positive() });

/** Lance une synchronisation. `full` reprend tout, `reconcile` la fenêtre de rattrapage. */
router.post(
  '/projects/:projectId/sync',
  validate({
    params: projectParam,
    body: z
      .object({
        kind: z.enum(['full', 'reconcile']).default('full'),
        withMedia: z.boolean().optional(),
      })
      .default({ kind: 'full' }),
  }),
  async (req, res) => {
    const projectId = Number(req.params.projectId);
    await assertProjectManager(req.user!, projectId);
    const result =
      req.body.kind === 'reconcile'
        ? await Sync.runReconcile(projectId)
        : await Sync.runSync(projectId, {
            kind: 'full',
            triggeredById: req.user!.id,
            withMedia: req.body.withMedia,
          });
    res.json({ result });
  },
);

router.get('/projects/:projectId/runs', validate({ params: projectParam }), async (req, res) => {
  const projectId = Number(req.params.projectId);
  await assertProjectManager(req.user!, projectId, { allowMembers: true });
  const conn = await Config.getConnectionOrThrow(projectId);
  res.json({
    runs: await Journal.listRuns(conn.id),
    openConflicts: await Journal.listOpenConflicts(conn.id),
  });
});

router.get(
  '/runs/:runId/logs',
  validate({
    params: runParam,
    query: z.object({
      level: z.enum(['info', 'warn', 'error', 'conflict']).optional(),
      skip: z.coerce.number().int().min(0).default(0),
      take: z.coerce.number().int().min(1).max(500).default(200),
    }),
  }),
  async (req, res) => {
    const runId = Number(req.params.runId);
    const run = await prisma.shotgridSyncRun.findUnique({
      where: { id: runId },
      include: { connection: { select: { projectId: true } } },
    });
    if (!run) throw notFound('Exécution introuvable');
    await assertProjectManager(req.user!, run.connection.projectId, { allowMembers: true });
    const { level, skip, take } = req.query as unknown as { level?: string; skip: number; take: number };
    res.json(await Journal.listLogs(runId, { level, skip, take }));
  },
);

/** Arbitrage d'un conflit laissé en attente (politique manuelle). */
/**
 * Arbitrage d'un conflit. Le journal ne se contente pas d'être classé : la décision
 * s'applique. « ShotGrid » relit l'entité distante et l'écrit par-dessus la locale ;
 * « ReView » pousse la valeur locale vers le site. Marquer la ligne résolue sans rien
 * faire laisserait l'écart en place, ce qui est pire que de ne rien proposer.
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
    if (!log) throw notFound('Ligne de journal introuvable');
    await assertProjectManager(req.user!, log.run.connection.projectId);

    const applied = await resolveConflict(
      log.run.connection.projectId,
      log,
      req.body.resolution,
      req.user!.id,
    );
    await prisma.shotgridSyncLog.update({
      where: { id: logId },
      data: { resolvedAt: new Date(), resolution: req.body.resolution },
    });
    res.json({ ok: true, applied });
  },
);

/**
 * Correspondances du projet — l'interface en tire les liens directs vers les fiches
 * ShotGrid. Une requête par projet plutôt qu'une par carte affichée.
 */
router.get('/projects/:projectId/links', validate({ params: projectParam }), async (req, res) => {
  const projectId = Number(req.params.projectId);
  await assertProjectManager(req.user!, projectId, { allowMembers: true });
  const conn = await Config.getConnection(projectId);
  if (!conn?.active) return res.json({ links: [] });
  const links = await prisma.shotgridLink.findMany({
    where: {
      connectionId: conn.id,
      localType: { in: ['sequence', 'shot', 'asset', 'task', 'version'] },
    },
    // `sgType` et `syncedAt` accompagnent le lien : le premier permet de réaligner une
    // entité sans redemander de quel type ShotGrid il s'agit, le second de dire depuis
    // quand elle n'a pas été relue. Une seule requête sert donc les liens directs ET
    // l'état d'alignement — une liste de 200 plans n'en déclenche pas 200.
    select: { localType: true, localId: true, sgId: true, sgType: true, syncedAt: true },
  });
  res.json({ links });
});

/**
 * Comparaison des deux côtés. Aucune écriture : elle sert à décider, pas à corriger.
 */
router.get('/projects/:projectId/diff', validate({ params: projectParam }), async (req, res) => {
  const projectId = Number(req.params.projectId);
  await assertProjectManager(req.user!, projectId, { allowMembers: true });
  res.json({ diff: await buildDiff(projectId) });
});

/** Publishes ShotGrid disponibles, importés ou non. */
router.get('/projects/:projectId/versions', validate({ params: projectParam }), async (req, res) => {
  const projectId = Number(req.params.projectId);
  await assertProjectManager(req.user!, projectId, { allowMembers: true });
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

/** Import à la carte : la sélection passe outre le filtre de statuts. */
router.post(
  '/projects/:projectId/import-versions',
  validate({
    params: projectParam,
    body: z.object({ sgIds: z.array(z.number().int().positive()).min(1).max(200) }),
  }),
  async (req, res) => {
    const projectId = Number(req.params.projectId);
    await assertProjectManager(req.user!, projectId);
    const ctx = await Config.openConnection(projectId);
    const journal = await SyncJournal.start(ctx.connection.id, 'import-versions', req.user!.id);
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
