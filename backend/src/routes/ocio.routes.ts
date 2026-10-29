// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import * as OcioService from '../services/OcioService';
import { logAudit } from '../services/AuditService';
import { enqueueOcioBake } from '../workers/ocio/queue';

/**
 * OCIO colour catalogue (39.B). Retrieves the ACES configs from the ASWF's GitHub releases, installs them
 * into MinIO, and sets the default config (ACES 1.3). Writes reserved to ADMIN. Reading the installed
 * configs is open to authenticated users (projects choose their display and view). Mounted on `/api/studio/ocio`.
 */
const router = Router();
router.use(authenticate);

// GET /api/studio/ocio/configs — installed configs (+ read URLs).
router.get('/configs', async (_req, res) => {
  res.json({ configs: await OcioService.listInstalled() });
});

// GET /api/studio/ocio/configs/:id/displays — displays and views of a config (project choice).
router.get(
  '/configs/:id/displays',
  validate({ params: z.object({ id: z.string().uuid() }) }),
  async (req, res) => {
    res.json({ displays: await OcioService.getConfigDisplays(req.params.id as string) });
  },
);

// GET /api/studio/ocio/configs/:id/lut — baked 3D LUT of a display/view pair (viewer).
// Lazy baking of the colorimetric fallback if it is missing; `url: null` if only the OCIO path can
// produce it (tone-mapped view, with the tooling absent from the worker).
router.get(
  '/configs/:id/lut',
  validate({
    params: z.object({ id: z.string().uuid() }),
    query: z.object({ display: z.string().min(1).max(160), view: z.string().min(1).max(160) }),
  }),
  async (req, res) => {
    const { display, view } = req.query as unknown as { display: string; view: string };
    res.json({ lut: await OcioService.getLut(req.params.id as string, display, view) });
  },
);

// POST /api/studio/ocio/configs/:id/bake — (re)bakes the LUTs of the config (admin).
router.post(
  '/configs/:id/bake',
  requireRole(Role.ADMIN),
  validate({
    params: z.object({ id: z.string().uuid() }),
    body: z.object({ force: z.boolean().optional() }).prefault({}),
  }),
  async (req, res) => {
    const id = req.params.id as string;
    const { force } = req.body as { force?: boolean };
    await enqueueOcioBake({ configId: id, force });
    logAudit({ userId: req.user!.id, action: 'OCIO_BAKE', entityType: 'Setting', metadata: { id } });
    res.status(202).json({ queued: true });
  },
);

// GET /api/studio/ocio/releases — available ACES releases (admin; GitHub fetch).
router.get('/releases', requireRole(Role.ADMIN), async (_req, res) => {
  res.json({ releases: await OcioService.listReleases() });
});

// POST /api/studio/ocio/install — installs a release asset (admin).
router.post(
  '/install',
  requireRole(Role.ADMIN),
  validate({ body: z.object({ tag: z.string().min(1).max(120), assetName: z.string().min(1).max(200) }) }),
  async (req, res) => {
    const { tag, assetName } = req.body as { tag: string; assetName: string };
    const config = await OcioService.install(tag, assetName);
    logAudit({
      userId: req.user!.id,
      action: 'OCIO_INSTALL',
      entityType: 'Setting',
      metadata: { id: config.id, assetName },
    });
    res.status(201).json({ config });
  },
);

// PUT /api/studio/ocio/configs/:id/default — sets the default config (admin).
router.put(
  '/configs/:id/default',
  requireRole(Role.ADMIN),
  validate({ params: z.object({ id: z.string().uuid() }) }),
  async (req, res) => {
    const id = req.params.id as string;
    const config = await OcioService.setDefault(id);
    logAudit({ userId: req.user!.id, action: 'OCIO_DEFAULT', entityType: 'Setting', metadata: { id } });
    res.json({ config });
  },
);

// DELETE /api/studio/ocio/configs/:id — deletes an installed config (admin).
router.delete(
  '/configs/:id',
  requireRole(Role.ADMIN),
  validate({ params: z.object({ id: z.string().uuid() }) }),
  async (req, res) => {
    const id = req.params.id as string;
    await OcioService.remove(id);
    logAudit({ userId: req.user!.id, action: 'OCIO_DELETE', entityType: 'Setting', metadata: { id } });
    res.status(204).end();
  },
);

export default router;
