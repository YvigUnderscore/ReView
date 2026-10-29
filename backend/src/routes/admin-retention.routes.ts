// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { validate } from '../middleware/validate';
import { logAudit } from '../services/AuditService';
import {
  MANUAL_MAX_BATCHES,
  RETENTION_DEFAULTS,
  getRetentionPolicy,
  retentionPolicySchema,
  setRetentionPolicy,
  sweepRetention,
} from '../lib/retention';

/**
 * Log retention: reading and setting retention durations, manual triggering of the sweep. The policy
 * itself lives in `lib/retention`.
 *
 * This router is mounted **inside** `admin.routes` (`router.use`), which has already set up
 * `authenticate` + `requireRole(ADMIN)`: it sets none of its own, and therefore exposes no public
 * route, see the mounting rule recalled in CLAUDE.md.
 */
const router = Router();

// GET /api/admin/retention — durations in force + product default values
router.get('/retention', async (_req, res) => {
  res.json({ policy: await getRetentionPolicy(), defaults: RETENTION_DEFAULTS });
});

/**
 * PUT /api/admin/retention: records the durations (0 = unlimited retention).
 *
 * The trace carries the BEFORE and the AFTER: "365 → 90 on the audit" can be read, "90" says nothing.
 * It is unpurgeable (`AUDIT_UNPURGEABLE_ACTIONS`), so a shortening of the audit retention remains
 * visible forever, including after the purge it orders.
 *
 * **No delay before taking effect**, deliberately (A5-04). Such a delay would add nothing here: the
 * floor `AUDIT_RETENTION_MIN_DAYS` already puts out of reach everything that happened recently, which
 * is the window a delay would protect, and the manoeuvre stays recorded indelibly. It would, however,
 * cost a "pending" policy to store, display and cancel, and it would delay the legitimate urgent case:
 * a GDPR erasure request, which must be honored without waiting a week.
 */
router.put('/retention', validate({ body: retentionPolicySchema }), async (req, res) => {
  const previous = await getRetentionPolicy();
  const policy = await setRetentionPolicy(req.body);
  logAudit({
    userId: req.user!.id,
    action: 'RETENTION_CONFIG',
    entityType: 'Setting',
    metadata: { previous, policy },
  });
  res.json({ policy, defaults: RETENTION_DEFAULTS });
});

/**
 * POST /api/admin/retention/run: immediate sweep (in response to a GDPR request, for example). Reduced
 * slice budget: the HTTP request must respond, and the rest of the backlog is caught up by the nightly
 * pass, which `truncated` tells the caller about.
 */
router.post('/retention/run', async (req, res) => {
  const { families, total, truncated } = await sweepRetention({ maxBatches: MANUAL_MAX_BATCHES });
  logAudit({
    userId: req.user!.id,
    action: 'RETENTION_RUN',
    entityType: 'Setting',
    metadata: { families, total, truncated },
  });
  res.json({ families, total, truncated });
});

export default router;
