import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import * as ReviewDecisionService from '../services/ReviewDecisionService';

/**
 * Statuts de review personnalisables du studio (Phase 31.A).
 * Lecture pour tous (badges/filtres) ; CRUD réservé ADMIN (onglet Contextes).
 */
const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int() });
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Couleur hex attendue (#RRGGBB)');
const statusBody = z.object({
  name: z.string().min(1).max(40),
  color: colorSchema,
  order: z.number().int().min(0).optional(),
  isApproval: z.boolean().optional(),
  isRetake: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

// GET /api/review-statuses — liste ordonnée (crée les statuts classiques au 1er accès)
router.get('/', async (_req, res) => {
  res.json({ statuses: await ReviewDecisionService.listStatuses() });
});

// POST /api/review-statuses — ADMIN
router.post('/', requireRole(Role.ADMIN), validate({ body: statusBody }), async (req, res) => {
  res.status(201).json({ status: await ReviewDecisionService.createStatus(req.user!, req.body) });
});

// PATCH /api/review-statuses/:id — ADMIN
router.patch(
  '/:id',
  requireRole(Role.ADMIN),
  validate({ params: idParam, body: statusBody.partial() }),
  async (req, res) => {
    res.json({
      status: await ReviewDecisionService.updateStatus(req.user!, Number(req.params.id), req.body),
    });
  },
);

// DELETE /api/review-statuses/:id — ADMIN (409 si utilisé par des décisions)
router.delete('/:id', requireRole(Role.ADMIN), validate({ params: idParam }), async (req, res) => {
  await ReviewDecisionService.deleteStatus(req.user!, Number(req.params.id));
  res.status(204).end();
});

export default router;
