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
 * Catalogue couleur OCIO (39.B). Récupération des configs ACES depuis les releases GitHub de
 * l'ASWF, installation dans MinIO, config par défaut (ACES 1.3). Écriture réservée ADMIN.
 * Lecture des configs installées ouverte aux authentifiés (les projets choisissent leur
 * display/view). Monté sur `/api/studio/ocio`.
 */
const router = Router();
router.use(authenticate);

// GET /api/studio/ocio/configs — configs installées (+ URL de lecture).
router.get('/configs', async (_req, res) => {
  res.json({ configs: await OcioService.listInstalled() });
});

// GET /api/studio/ocio/configs/:id/displays — displays/views d'une config (choix projet).
router.get(
  '/configs/:id/displays',
  validate({ params: z.object({ id: z.string().uuid() }) }),
  async (req, res) => {
    res.json({ displays: await OcioService.getConfigDisplays(req.params.id as string) });
  },
);

// GET /api/studio/ocio/configs/:id/lut — LUT 3D cuite d'un couple display/view (viewer).
// Cuisson paresseuse du repli colorimétrique si elle manque ; `url: null` si seule la voie
// OCIO peut la produire (vue tone-mappée + outillage absent du worker).
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

// POST /api/studio/ocio/configs/:id/bake — (re)cuisson des LUT de la config (admin).
router.post(
  '/configs/:id/bake',
  requireRole(Role.ADMIN),
  validate({
    params: z.object({ id: z.string().uuid() }),
    body: z.object({ force: z.boolean().optional() }).default({}),
  }),
  async (req, res) => {
    const id = req.params.id as string;
    const { force } = req.body as { force?: boolean };
    await enqueueOcioBake({ configId: id, force });
    logAudit({ userId: req.user!.id, action: 'OCIO_BAKE', entityType: 'Setting', metadata: { id } });
    res.status(202).json({ queued: true });
  },
);

// GET /api/studio/ocio/releases — releases ACES disponibles (admin ; fetch GitHub).
router.get('/releases', requireRole(Role.ADMIN), async (_req, res) => {
  res.json({ releases: await OcioService.listReleases() });
});

// POST /api/studio/ocio/install — installe un asset de release (admin).
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

// PUT /api/studio/ocio/configs/:id/default — définit la config par défaut (admin).
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

// DELETE /api/studio/ocio/configs/:id — supprime une config installée (admin).
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
