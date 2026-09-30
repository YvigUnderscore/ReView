// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notFound } from '../lib/errors';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { MATCH_TYPES, VISIBILITY_TYPES } from '../lib/visibility';
import * as VisibilityService from '../services/VisibilityService';

/**
 * Masquage d'éléments — réservé aux ADMIN.
 *
 * Un SUPERVISOR administre son projet ; faire disparaître un plan de tous les écrans de
 * tout le monde est d'un autre ordre. La lecture des règles l'est aussi : elles exposent
 * les conventions internes du studio, et un artiste n'a rien à en faire.
 */
const router = Router();

/**
 * ⚠ Routeur monté sur `/api` : pas de `router.use(authenticate)` — Express l'exécuterait
 * pour toute requête traversant le point de montage, routes publiques comprises.
 */
const auth = authenticate;
const admin = requireRole(Role.ADMIN);

const idParam = z.object({ id: z.coerce.number().int().positive() });
const kindParam = z.object({
  kind: z.enum(['episode', 'sequence', 'shot', 'asset']),
  id: z.coerce.number().int().positive(),
});

const ruleBody = z.object({
  projectId: z.number().int().positive().nullish(),
  entityType: z.enum(VISIBILITY_TYPES),
  matchType: z.enum(MATCH_TYPES),
  pattern: z.string().min(1).max(200),
  ignoreCase: z.boolean().optional(),
  reason: z.string().max(500).nullish(),
  enabled: z.boolean().optional(),
});

/** Le studio de l'instance — une instance = un studio (cf. CLAUDE.md). */
async function currentStudioId(): Promise<number> {
  const project = await prisma.project.findFirst({ select: { studioId: true } });
  if (!project) throw notFound('No studio yet');
  return project.studioId;
}

router.get(
  '/visibility/rules',
  auth,
  admin,
  validate({ query: z.object({ projectId: z.coerce.number().int().positive().optional() }) }),
  async (req, res) => {
    const studioId = await currentStudioId();
    const projectId = req.query.projectId === undefined ? undefined : Number(req.query.projectId);
    res.json({ rules: await VisibilityService.listRules(studioId, projectId) });
  },
);

router.post('/visibility/rules', auth, admin, validate({ body: ruleBody }), async (req, res) => {
  const studioId = await currentStudioId();
  const { rule, applied } = await VisibilityService.createRule(studioId, req.user!.id, req.body);
  res.status(201).json({ rule, applied });
});

router.patch(
  '/visibility/rules/:id',
  auth,
  admin,
  validate({ params: idParam, body: ruleBody.partial() }),
  async (req, res) => {
    const studioId = await currentStudioId();
    const { rule, applied } = await VisibilityService.updateRule(studioId, Number(req.params.id), req.body);
    res.json({ rule, applied });
  },
);

router.delete('/visibility/rules/:id', auth, admin, validate({ params: idParam }), async (req, res) => {
  const studioId = await currentStudioId();
  res.json({ applied: await VisibilityService.deleteRule(studioId, Number(req.params.id)) });
});

/**
 * Rejouer les règles à la demande.
 *
 * Elles le sont déjà à chaque changement et après chaque import, mais un studio qui vient
 * d'en écrire une série veut pouvoir constater le résultat sans attendre la prochaine
 * synchronisation.
 */
router.post(
  '/visibility/apply',
  auth,
  admin,
  validate({ body: z.object({ projectId: z.number().int().positive().optional() }) }),
  async (req, res) => {
    const studioId = await currentStudioId();
    res.json({ applied: await VisibilityService.applyRules(studioId, req.body.projectId) });
  },
);

/** Masquer ou révéler un élément précis, sans écrire de règle. */
router.put(
  '/visibility/:kind/:id',
  auth,
  admin,
  validate({
    params: kindParam,
    body: z.object({ hidden: z.boolean(), reason: z.string().max(500).nullish() }),
  }),
  async (req, res) => {
    await VisibilityService.setHidden(
      req.params.kind as 'episode' | 'sequence' | 'shot' | 'asset',
      Number(req.params.id),
      req.body.hidden,
      req.body.reason,
    );
    res.status(204).end();
  },
);

export default router;
