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
 * Rétention des journaux : lecture et réglage des durées de conservation, déclenchement
 * manuel du balayage. La politique elle-même vit dans `lib/retention`.
 *
 * Ce routeur est monté **dans** `admin.routes` (`router.use`), qui a déjà posé
 * `authenticate` + `requireRole(ADMIN)` : il n'en repose aucun de son côté, et n'expose
 * donc aucune route publique — cf. la règle de montage rappelée dans CLAUDE.md.
 */
const router = Router();

// GET /api/admin/retention — durées en vigueur + valeurs par défaut du produit
router.get('/retention', async (_req, res) => {
  res.json({ policy: await getRetentionPolicy(), defaults: RETENTION_DEFAULTS });
});

// PUT /api/admin/retention — enregistre les durées (0 = conservation illimitée)
router.put('/retention', validate({ body: retentionPolicySchema }), async (req, res) => {
  const policy = await setRetentionPolicy(req.body);
  logAudit({ userId: req.user!.id, action: 'RETENTION_CONFIG', entityType: 'Setting', metadata: policy });
  res.json({ policy, defaults: RETENTION_DEFAULTS });
});

/**
 * POST /api/admin/retention/run — balayage immédiat (réponse à une demande RGPD, par
 * exemple). Budget de tranches réduit : la requête HTTP doit répondre, le reste du retard
 * est rattrapé par la passe nocturne, que `truncated` annonce à l'appelant.
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
