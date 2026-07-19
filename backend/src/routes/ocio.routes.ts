import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import * as OcioService from '../services/OcioService';
import { logAudit } from '../services/AuditService';

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
