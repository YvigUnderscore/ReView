// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { authenticate, requireUser } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { env } from '../config/env';
import * as Config from '../services/shotgrid/ShotgridConfigService';
import { parseSettings, shotgridSettingsSchema } from '../services/shotgrid/shotgridSettings';
import { assertProjectManager } from '../lib/shotgridAccess';
import { scheduleShotgridJobs } from '../services/shotgrid/ShotgridSchedule';
import { logger } from '../lib/logger';
import type { Request } from 'express';

/**
 * ShotGrid configuration: the studio's sites (ADMIN) and the connection of a project (ADMIN or the
 * project's supervisor). No key or password ever leaves the API.
 */
const router = Router();
router.use(authenticate);

/** The instance's public address: explicit setting, otherwise the origin of the request. */
const publicUrl = (req: Request): string =>
  env.APP_URL ?? `${req.protocol}://${req.get('host') ?? 'localhost'}`;

const idParam = z.object({ id: z.coerce.number().int().positive() });
const projectParam = z.object({ projectId: z.coerce.number().int().positive() });

const siteBody = z.object({
  name: z.string().min(1).max(80),
  baseUrl: z.string().min(8).max(300),
  authMode: z.enum(['script', 'user']),
  scriptName: z.string().max(120).nullish(),
  scriptKey: z.string().max(300).nullish(),
  login: z.string().max(160).nullish(),
  password: z.string().max(300).nullish(),
});

router.get('/sites', requireRole(Role.ADMIN), async (_req, res) => {
  res.json({ sites: await Config.listSites() });
});

router.post('/sites', requireRole(Role.ADMIN), validate({ body: siteBody }), async (req, res) => {
  res.status(201).json({ site: await Config.createSite(req.body) });
});

router.patch(
  '/sites/:id',
  requireRole(Role.ADMIN),
  validate({ params: idParam, body: siteBody.partial() }),
  async (req, res) => {
    res.json({ site: await Config.updateSite(Number(req.params.id), req.body) });
  },
);

router.delete('/sites/:id', requireRole(Role.ADMIN), validate({ params: idParam }), async (req, res) => {
  await Config.deleteSite(Number(req.params.id));
  res.status(204).end();
});

/** Real authentication test against the site. */
router.post('/sites/:id/test', requireRole(Role.ADMIN), validate({ params: idParam }), async (req, res) => {
  res.json(await Config.testSite(Number(req.params.id)));
});

/**
 * The site's projects. This list lets the user designate their target by name: the identifier alone
 * would be unreadable, and picking the wrong project is the error one is trying to make impossible.
 */
router.get(
  '/sites/:id/projects',
  validate({ params: idParam, query: z.object({ query: z.string().max(120).optional() }) }),
  async (req, res) => {
    if (requireUser(req).role !== Role.ADMIN && requireUser(req).role !== Role.SUPERVISOR)
      return res.status(403).json({ error: 'Supervisors and administrators only' });
    res.json({
      projects: await Config.listRemoteProjects(Number(req.params.id), req.query.query as string | undefined),
    });
  },
);

// ───────────────────────────── Connecting a project ─────────────────────────────

const connectionBody = z.object({
  siteId: z.number().int().positive(),
  sgProjectId: z.number().int().positive(),
  // Display name shown to the user when choosing: checked against the real name before
  // anything is recorded.
  sgProjectName: z.string().min(1).max(200),
});

router.post(
  '/projects/:projectId/connection',
  validate({ params: projectParam, body: connectionBody }),
  async (req, res) => {
    const projectId = Number(req.params.projectId);
    await assertProjectManager(requireUser(req), projectId);
    const conn = await Config.createConnection(projectId, req.body);
    res.status(201).json({ connection: Config.connectionView(conn, publicUrl(req)) });
  },
);

router.get('/projects/:projectId/connection', validate({ params: projectParam }), async (req, res) => {
  const projectId = Number(req.params.projectId);
  await assertProjectManager(requireUser(req), projectId, { allowMembers: true });
  const conn = await Config.getConnection(projectId);
  res.json({ connection: conn ? Config.connectionView(conn, publicUrl(req)) : null });
});

router.patch(
  '/projects/:projectId/connection',
  validate({
    params: projectParam,
    body: z.object({
      settings: shotgridSettingsSchema.partial().optional(),
      active: z.boolean().optional(),
      webhookSecret: z.string().max(200).nullish(),
    }),
  }),
  async (req, res) => {
    const projectId = Number(req.params.projectId);
    await assertProjectManager(requireUser(req), projectId);
    const current = await Config.getConnectionOrThrow(projectId);
    // Merge: the UI only sends the section that changed, the rest must survive. It is done one level deep,
    // and from the **normalized** settings: a flat merge let `shotgridSettingsSchema.partial()` re-parse
    // each section received with its defaults, so sending a single domain reset the six others to
    // "read and write". A client sending only one field reopened writes.
    const merged = req.body.settings
      ? Config.mergeSettings(parseSettings(current.settings), req.body.settings)
      : undefined;
    // Reopening a domain for writing clears its alert: the banner signals a problem in progress,
    // not a historical trace.
    const cleared = merged ? Config.clearedBlocks(current.pushBlocked, merged) : undefined;
    const conn = await Config.updateConnection(projectId, {
      ...req.body,
      settings: merged,
      ...(cleared ? { pushBlocked: cleared } : {}),
    });
    // The rhythm (event mode, polling interval, reconciliation time) lives in repeatable Redis jobs, set
    // once at startup. Without this re-scheduling, switching a connection to polling recorded nothing
    // until the next restart: the setting seemed taken into account and was not.
    void scheduleShotgridJobs().catch((err: unknown) => {
      logger.error({ err, projectId }, 'Could not reschedule the ShotGrid periodic jobs');
    });
    res.json({ connection: Config.connectionView(conn, publicUrl(req)) });
  },
);

router.delete('/projects/:projectId/connection', validate({ params: projectParam }), async (req, res) => {
  const projectId = Number(req.params.projectId);
  await assertProjectManager(requireUser(req), projectId, { adminOnly: true });
  await Config.deleteConnection(projectId);
  res.status(204).end();
});

/** Signing secret, in clear and never cached: see `revealWebhookSecret`. */
router.get(
  '/projects/:projectId/connection/webhook-secret',
  validate({ params: projectParam }),
  async (req, res) => {
    const projectId = Number(req.params.projectId);
    await assertProjectManager(requireUser(req), projectId);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ secret: await Config.revealWebhookSecret(projectId) });
  },
);

/** New secret, to be reported in the site's webhook: see `rotateWebhookSecret`. */
router.post(
  '/projects/:projectId/connection/rotate-secret',
  validate({ params: projectParam }),
  async (req, res) => {
    const projectId = Number(req.params.projectId);
    await assertProjectManager(requireUser(req), projectId);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ secret: await Config.rotateWebhookSecret(projectId) });
  },
);

/** Rotation of the webhook's URL token (the old address immediately stops answering). */
router.post(
  '/projects/:projectId/connection/rotate-token',
  validate({ params: projectParam }),
  async (req, res) => {
    const projectId = Number(req.params.projectId);
    await assertProjectManager(requireUser(req), projectId);
    const conn = await Config.rotateWebhookToken(projectId);
    res.json({ connection: Config.connectionView(conn, publicUrl(req)) });
  },
);

export default router;
