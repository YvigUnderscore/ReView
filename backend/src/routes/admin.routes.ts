import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { logAudit } from '../services/AuditService';
import {
  getStudioProjectDefaults,
  setStudioProjectDefaults,
  projectSettingsSchema,
} from '../lib/projectSettings';
import * as AdminService from '../services/AdminService';

const router = Router();
router.use(authenticate, requireRole(Role.ADMIN));

// GET /api/admin/project-defaults — réglages par défaut des nouveaux projets
router.get('/project-defaults', async (_req, res) => {
  res.json({ settings: await getStudioProjectDefaults() });
});

// PUT /api/admin/project-defaults — départements + nomenclature + pipeline par défaut
router.put('/project-defaults', validate({ body: projectSettingsSchema }), async (req, res) => {
  const settings = await setStudioProjectDefaults(req.body);
  logAudit({ userId: req.user!.id, action: 'PROJECT_DEFAULTS_UPDATE', entityType: 'Setting' });
  res.json({ settings });
});

// GET /api/admin/dashboard — métriques studio (compat. ascendante, vue compacte)
router.get('/dashboard', async (_req, res) => {
  res.json(await AdminService.dashboard());
});

// GET /api/admin/stats — métriques métier complètes (admin)
router.get('/stats', async (_req, res) => {
  res.json(await AdminService.stats());
});

// GET /api/admin/system — métriques système + santé des services (admin)
router.get('/system', async (_req, res) => {
  res.json(await AdminService.system());
});

// GET /api/admin/activity?days=30 — séries temporelles (uploads & stockage / jour)
router.get('/activity', async (req, res) => {
  res.json(await AdminService.activity(Number(req.query.days)));
});

// GET /api/admin/trash — projets supprimés (corbeille globale, admin)
router.get('/trash', async (_req, res) => {
  res.json({ projects: await AdminService.trashProjects() });
});

// POST /api/admin/jobs/retry — relance tous les jobs média en échec (admin)
router.post('/jobs/retry', async (req, res) => {
  res.json({ retried: await AdminService.retryFailedJobs(req.user!.id) });
});

export default router;
