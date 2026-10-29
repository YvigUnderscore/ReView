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
 * Default layouts of a project's overview, one per role (Phase 50, batch 10).
 *
 * **Reading is open to all logged-in users**: everyone needs the default of their role to open the page,
 * and a screen's layout reveals nothing about the studio. Only writing is reserved for administration:
 * it decides what an artist who has customized nothing sees.
 */
const router = Router();
router.use(authenticate);

// GET /api/studio/overview-layout — defaults per role; a role that is absent has never been set.
router.get('/overview-layout', async (_req, res) => {
  res.json({ defaults: await OverviewLayoutService.getRoleDefaults() });
});

/**
 * PUT /api/studio/overview-layout: sets (or removes, with `layout: null`) the default of ONE role. One
 * role at a time: replacing the whole map would turn an artist's setting into a silent erasure of the
 * supervisors' one.
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
