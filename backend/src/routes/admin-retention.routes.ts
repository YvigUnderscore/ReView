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

/**
 * PUT /api/admin/retention — enregistre les durées (0 = conservation illimitée).
 *
 * La trace porte l'AVANT et l'APRÈS : « 365 → 90 sur l'audit » se lit, « 90 » ne dit rien.
 * Elle est inpurgeable (`AUDIT_UNPURGEABLE_ACTIONS`), donc un raccourcissement de la
 * rétention d'audit reste visible pour toujours, y compris après la purge qu'il commande.
 *
 * **Pas de délai avant prise d'effet**, délibérément (A5-04). Un tel délai n'apporterait
 * rien de plus ici : le plancher `AUDIT_RETENTION_MIN_DAYS` met déjà hors d'atteinte tout
 * ce qui s'est passé récemment — la fenêtre que le délai protégerait —, et la manœuvre
 * reste consignée de façon indélébile. Il coûterait en revanche une politique « en
 * attente » à stocker, afficher et annuler, et il retarderait le cas légitime pressé :
 * une demande d'effacement RGPD, qui doit être honorée sans attendre une semaine.
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
