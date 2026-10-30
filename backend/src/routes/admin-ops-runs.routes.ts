// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { authenticate, requireUser } from '../middleware/auth';
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
 * Orders an operation and follows its progress.
 *
 * Mounted under `/api/admin/ops`, before the read router. Separated from it for two reasons: the
 * 200-line budget per route, and the fact that **everything written here** (and therefore obeys
 * guards that reading does not) lives apart.
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
     * The admin's password, as for issuing a service token. It does not defend against a stolen
     * session (an attacker holding an admin session can also create an account), but it stops the
     * accidental click and the tab left open. The real second barrier is `deploy/agent.conf`, out of
     * the application's reach.
     */
    currentPassword: z.string().min(1).max(200),
  })
  .refine((b) => b.kind !== 'update' || Boolean(b.version), { message: 'version required' })
  .refine((b) => b.kind !== 'verify' || Boolean(b.backupId), { message: 'backupId required' });

/** Translates the state of the mechanism into a readable refusal, never a button that does nothing. */
function assertUsable(mechanism: Awaited<ReturnType<typeof OpsSpoolService.mechanism>>, kind: OpsKind): void {
  if (mechanism.state === 'busy') throw conflict('An operation is already running', 'OPS_BUSY');
  if (mechanism.state !== 'ready') {
    throw conflict(`Operations agent unavailable: ${mechanism.reason ?? mechanism.state}`, 'OPS_UNAVAILABLE');
  }
  if (!mechanism.allow[kind]) throw conflict(`Operation ${kind} is not allowed`, 'OPS_NOT_ALLOWED');
}

// POST /api/admin/ops/runs — orders an operation.
//
// Bounded: ten per hour and per account. An update interrupts the whole studio; nobody orders ten in
// an hour, but a runaway tab or a stray script might.
router.post(
  '/runs',
  rateLimit({ name: 'ops-run', windowMs: 60 * 60_000, max: 10, keyGenerator: identityRateKey }),
  validate({ body: createBody }),
  async (req, res) => {
    const body = req.body as z.infer<typeof createBody>;
    await ApiTokenService.assertActorPassword(requireUser(req).id, body.currentPassword);

    const mechanism = await OpsSpoolService.mechanism();
    assertUsable(mechanism, body.kind);

    // Reject early a label that does not exist: otherwise the failure would only appear after the
    // backup, once the instance is already stopped. This is an ergonomics check: the security guard
    // (refusal of a downgrade) lives on the agent side, out of this process's reach.
    if (body.kind === 'update' && !(await ReleaseService.isPublishedTag(body.version!))) {
      throw badRequest('No such published release', 'RELEASE_UNKNOWN');
    }

    const run = {
      id: newRunId(new Date()),
      actor: { id: requireUser(req).id, displayName: requireUser(req).email },
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

    // Logged BEFORE the drop, never after: an operation that goes wrong is precisely the one whose
    // initiator we want to know, and a trace written at the end would miss all those that never reach
    // their end.
    logAudit({
      userId: requireUser(req).id,
      action:
        body.kind === 'update' ? 'INSTANCE_UPDATE' : `BACKUP_${body.kind === 'backup' ? 'CREATE' : 'VERIFY'}`,
      entityType: body.kind === 'update' ? 'Release' : 'Backup',
      metadata: { runId: run.id, version: body.version ?? null, backupId: body.backupId ?? null },
    });

    await OpsSpoolService.enqueue(order);
    res.status(202).json({ run: await OpsSpoolService.readRun(run.id) });
  },
);

// GET /api/admin/ops/runs — short history.
router.get(
  '/runs',
  validate({ query: z.object({ limit: z.coerce.number().int().min(1).max(20).default(10) }) }),
  async (req, res) => {
    res.json({ runs: await OpsSpoolService.listRuns(Number(req.query.limit)) });
  },
);

// GET /api/admin/ops/runs/:runId — state and log slice from a byte offset.
//
// Polled in a loop by the screen, including while the API restarts: this route, not a socket, is what
// lets one find an operation ordered by the PREVIOUS backend. The socket dies with the process that
// opened it.
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

// POST /api/admin/ops/runs/:runId/cancel — abort sentinel.
router.post(
  '/runs/:runId/cancel',
  validate({ params: z.object({ runId: z.string().regex(RUN_ID) }) }),
  async (req, res) => {
    const run = await OpsSpoolService.readRun(String(req.params.runId));
    if (!run) throw notFound();
    // A committed switchover is not undone by killing the script: the automatic rollback, for its part,
    // would not have taken place. The agent applies the same rule on its side.
    if (!run.cancellable) throw conflict('This operation can no longer be cancelled', 'OPS_RUN_FINISHED');
    await OpsSpoolService.cancel(run.id);
    res.status(202).json({ run: await OpsSpoolService.readRun(run.id) });
  },
);

export default router;
