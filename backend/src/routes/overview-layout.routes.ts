// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { Role } from '@prisma/client';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import * as AuditService from '../services/AuditService';
import * as OverviewLayoutService from '../services/OverviewLayoutService';
import { overviewLayoutSchema } from '../lib/overviewWidgets';

/**
 * Dispositions par défaut de la vue d'ensemble d'un projet, une par rôle (Phase 50, lot 10).
 *
 * La **lecture est ouverte à tous les connectés** : chacun a besoin du défaut de son rôle
 * pour ouvrir la page, et la disposition d'un écran n'apprend rien sur le studio. Seule
 * l'écriture est réservée à l'administration — c'est elle qui décide de ce que voit un
 * artiste qui n'a rien personnalisé.
 */
const router = Router();
router.use(authenticate);

// GET /api/studio/overview-layout — les défauts par rôle ; un rôle absent n'a jamais été réglé.
router.get('/overview-layout', async (_req, res) => {
  res.json({ defaults: await OverviewLayoutService.getRoleDefaults() });
});

/**
 * PUT /api/studio/overview-layout — règle (ou retire, avec `layout: null`) le défaut d'UN
 * rôle. Un rôle à la fois : remplacer la carte entière ferait d'un réglage d'artiste un
 * effacement silencieux de celui des superviseurs.
 */
router.put(
  '/overview-layout',
  requireRole(Role.ADMIN),
  validate({
    body: z.object({ role: z.nativeEnum(Role), layout: overviewLayoutSchema.nullable() }),
  }),
  async (req, res) => {
    const { role, layout } = req.body as { role: Role; layout: z.infer<typeof overviewLayoutSchema> | null };
    const defaults = await OverviewLayoutService.setRoleDefault(role, layout);
    AuditService.logAudit({
      userId: req.user!.id,
      action: 'OVERVIEW_LAYOUT_UPDATE',
      entityType: 'Setting',
      metadata: { role, cleared: layout === null },
    });
    res.json({ defaults });
  },
);

export default router;
