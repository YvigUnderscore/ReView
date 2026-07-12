import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import * as HdriService from '../services/HdriService';
import { HDRI_FORMATS } from '../services/HdriService';
import { logAudit } from '../services/AuditService';

/**
 * Bibliothèque HDRI (Phase 15 V4). Lecture pour tout utilisateur authentifié (le viewer 3D
 * en a besoin) ; écriture réservée ADMIN. Monté sur `/api/studio/hdris`.
 */
const router = Router();
router.use(authenticate);

const formatSchema = z.enum(HDRI_FORMATS);

// GET /api/studio/hdris — liste + URLs présignées
router.get('/', async (_req, res) => {
  res.json({ hdris: await HdriService.listWithUrls() });
});

// POST /api/studio/hdris/presign — URL d'upload (admin)
router.post(
  '/presign',
  requireRole(Role.ADMIN),
  validate({ body: z.object({ format: formatSchema }) }),
  async (req, res) => {
    const { format } = req.body as { format: HdriService.HdriFormat };
    res.json(await HdriService.presignUpload(format));
  },
);

// POST /api/studio/hdris — finalise l'ajout (admin)
router.post(
  '/',
  requireRole(Role.ADMIN),
  validate({
    body: z.object({
      name: z.string().min(1).max(120),
      storageKey: z.string().min(1).max(300),
      format: formatSchema,
    }),
  }),
  async (req, res) => {
    const { name, storageKey, format } = req.body as {
      name: string;
      storageKey: string;
      format: HdriService.HdriFormat;
    };
    const entry = await HdriService.add(name, storageKey, format);
    logAudit({ userId: req.user!.id, action: 'HDRI_ADD', entityType: 'Setting', metadata: { id: entry.id } });
    res.status(201).json({ hdri: entry });
  },
);

// DELETE /api/studio/hdris/:id — supprime (admin)
router.delete(
  '/:id',
  requireRole(Role.ADMIN),
  validate({ params: z.object({ id: z.string().uuid() }) }),
  async (req, res) => {
    const id = req.params.id as string;
    await HdriService.remove(id);
    logAudit({ userId: req.user!.id, action: 'HDRI_DELETE', entityType: 'Setting', metadata: { id } });
    res.status(204).end();
  },
);

export default router;
