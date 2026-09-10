// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { identityRateKey, rateLimit } from '../middleware/rateLimit';
import { badRequest, conflict, notFound } from '../lib/errors';
import { BACKUP_STAMP, RUN_ID, VERSION_TAG, buildOrder, newRunId, type OpsKind } from '../lib/opsOrder';
import { logAudit } from '../services/AuditService';
import * as ApiTokenService from '../services/ApiTokenService';
import * as OpsSpoolService from '../services/OpsSpoolService';
import * as ReleaseService from '../services/ReleaseService';
import { env } from '../config/env';

/**
 * Commander une opération, et en suivre le déroulement.
 *
 * Monté sous `/api/admin/ops`, avant le routeur de lecture. Séparé de lui pour deux
 * raisons : le budget de 200 lignes par route, et le fait que **tout ce qui est ici écrit**
 * — donc obéit à des gardes que la lecture n'a pas.
 */
const router = Router();
router.use(authenticate, requireRole(Role.ADMIN));
router.use((req, _res, next) => {
  next(
    req.apiToken ? badRequest('An API token cannot operate the instance', 'API_TOKEN_FORBIDDEN') : undefined,
  );
});

const createBody = z
  .object({
    kind: z.enum(['update', 'backup', 'verify']),
    version: z.string().regex(VERSION_TAG).optional(),
    backupId: z.string().regex(BACKUP_STAMP).optional(),
    skipBackup: z.boolean().default(false),
    /**
     * Mot de passe de l'admin, comme pour l'émission d'un token de service. Il ne défend
     * pas contre une session volée — un attaquant qui tient une session admin sait aussi
     * créer un compte — mais il arrête le clic accidentel et l'onglet resté ouvert. La
     * vraie seconde barrière est `deploy/agent.conf`, hors de portée de l'application.
     */
    currentPassword: z.string().min(1).max(200),
  })
  .refine((b) => b.kind !== 'update' || Boolean(b.version), { message: 'version required' })
  .refine((b) => b.kind !== 'verify' || Boolean(b.backupId), { message: 'backupId required' });

/** Traduit l'état du mécanisme en refus lisible — jamais un bouton qui ne fait rien. */
function assertUsable(mechanism: Awaited<ReturnType<typeof OpsSpoolService.mechanism>>, kind: OpsKind): void {
  if (mechanism.state === 'busy') throw conflict('An operation is already running', 'OPS_BUSY');
  if (mechanism.state !== 'ready') {
    throw conflict(`Operations agent unavailable: ${mechanism.reason ?? mechanism.state}`, 'OPS_UNAVAILABLE');
  }
  if (!mechanism.allow[kind]) throw conflict(`Operation ${kind} is not allowed`, 'OPS_NOT_ALLOWED');
}

// POST /api/admin/ops/runs — commande une opération.
//
// Borné : dix par heure et par compte. Une mise à jour interrompt tout le studio ; personne
// n'en commande dix dans l'heure, mais un onglet fou ou un script égaré, si.
router.post(
  '/runs',
  rateLimit({ name: 'ops-run', windowMs: 60 * 60_000, max: 10, keyGenerator: identityRateKey }),
  validate({ body: createBody }),
  async (req, res) => {
    const body = req.body as z.infer<typeof createBody>;
    await ApiTokenService.assertActorPassword(req.user!.id, body.currentPassword);

    const mechanism = await OpsSpoolService.mechanism();
    assertUsable(mechanism, body.kind);

    // Refuser tôt une étiquette qui n'existe pas : sinon l'échec n'apparaîtrait qu'après la
    // sauvegarde, une fois l'instance déjà arrêtée. Contrôle d'ergonomie — le garde-fou de
    // sécurité (refus de rétrogradation) est côté agent, hors de portée de ce processus.
    if (body.kind === 'update' && !(await ReleaseService.isPublishedTag(body.version!))) {
      throw badRequest('No such published release', 'RELEASE_UNKNOWN');
    }

    const run = {
      id: newRunId(new Date()),
      actor: { id: req.user!.id, displayName: req.user!.email },
    };
    const order = buildOrder({
      id: run.id,
      kind: body.kind,
      now: new Date(),
      ttlSec: env.OPS_ORDER_TTL_SEC,
      actor: run.actor,
      version: body.version ?? null,
      backupId: body.backupId ?? null,
      skipBackup: body.skipBackup,
    });

    // Tracé AVANT le dépôt, jamais après : une opération qui tourne mal est précisément
    // celle dont on veut savoir qui l'a lancée, et une trace posée à la fin manquerait
    // toutes celles qui n'arrivent pas à leur fin.
    logAudit({
      userId: req.user!.id,
      action:
        body.kind === 'update' ? 'INSTANCE_UPDATE' : `BACKUP_${body.kind === 'backup' ? 'CREATE' : 'VERIFY'}`,
      entityType: body.kind === 'update' ? 'Release' : 'Backup',
      metadata: { runId: run.id, version: body.version ?? null, backupId: body.backupId ?? null },
    });

    await OpsSpoolService.enqueue(order);
    res.status(202).json({ run: await OpsSpoolService.readRun(run.id) });
  },
);

// GET /api/admin/ops/runs — historique court.
router.get(
  '/runs',
  validate({ query: z.object({ limit: z.coerce.number().int().min(1).max(20).default(10) }) }),
  async (req, res) => {
    res.json({ runs: await OpsSpoolService.listRuns(Number(req.query.limit)) });
  },
);

// GET /api/admin/ops/runs/:runId — état + tranche de journal depuis un décalage d'octets.
//
// Sondé en boucle par l'écran, y compris pendant que l'API redémarre : c'est cette route,
// et non un socket, qui permet de retrouver une opération commandée par le backend
// PRÉCÉDENT — le socket, lui, meurt avec le processus qui l'a ouvert.
router.get(
  '/runs/:runId',
  validate({
    params: z.object({ runId: z.string().regex(RUN_ID) }),
    query: z.object({ from: z.coerce.number().int().min(0).default(0) }),
  }),
  async (req, res) => {
    const run = await OpsSpoolService.readRun(String(req.params.runId));
    if (!run) throw notFound();
    res.json({ run, log: await OpsSpoolService.readLog(run.id, Number(req.query.from)) });
  },
);

// POST /api/admin/ops/runs/:runId/cancel — sentinelle d'abandon.
router.post(
  '/runs/:runId/cancel',
  validate({ params: z.object({ runId: z.string().regex(RUN_ID) }) }),
  async (req, res) => {
    const run = await OpsSpoolService.readRun(String(req.params.runId));
    if (!run) throw notFound();
    // Une bascule engagée ne se défait pas en tuant le script : le retour arrière
    // automatique, lui, n'aurait pas eu lieu. L'agent applique la même règle de son côté.
    if (!run.cancellable) throw conflict('This operation can no longer be cancelled', 'OPS_RUN_FINISHED');
    await OpsSpoolService.cancel(run.id);
    res.status(202).json({ run: await OpsSpoolService.readRun(run.id) });
  },
);

export default router;
