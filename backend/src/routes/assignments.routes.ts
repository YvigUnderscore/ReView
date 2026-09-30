// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router, type Request } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { assertProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { resolveProjectIdForVersion } from '../lib/pipeline';
import { notFound } from '../lib/errors';
import { reviewNoteSchema } from '../lib/projectSettings';
import * as AssignmentService from '../services/AssignmentService';
import * as ReviewAssignmentService from '../services/ReviewAssignmentService';

/**
 * Assignation d'une personne sur un asset, un plan, ou la review d'une version.
 *
 * Pour un asset ou un plan, l'écriture porte sur les tâches de l'entité, jamais sur
 * l'entité elle-même — voir `AssignmentService` pour le pourquoi. Les droits sont vérifiés
 * dans le service, sur le projet résolu : un superviseur de projet dont le compte est
 * ARTIST doit pouvoir le faire, ce qu'un `requireRole` sur le rôle global lui refuserait.
 *
 * La review d'une version est le troisième geste et le seul qui ne crée rien : elle dit
 * « c'est à toi de regarder ça » (Phase 49), et se lit dans l'encart « Assigned to me ».
 */
const router = Router();

/**
 * ⚠ Routeur monté sur `/api` (il sert deux préfixes) : jamais de `router.use(authenticate)`,
 * qui s'appliquerait à toute requête traversant le point de montage, routes publiques
 * comprises. L'authentification est posée route par route.
 */
const auth = authenticate;

const idParam = z.object({ id: z.coerce.number().int().positive() });
const assignBody = z.object({
  /** `null` désassigne. */
  userId: z.number().int().positive().nullable(),
  departmentIds: z.array(z.number().int().positive()).max(50).optional(),
});

for (const [segment, holder] of [
  ['assets', 'asset'],
  ['shots', 'shot'],
] as const) {
  router.post(
    `/${segment}/:id/assign`,
    auth,
    validate({ params: idParam, body: assignBody }),
    async (req, res) => {
      const result = await AssignmentService.assignEntity(req.user!, {
        holder,
        id: Number(req.params.id),
        userId: req.body.userId,
        departmentIds: req.body.departmentIds,
      });
      res.json(result);
    },
  );
}

/** Résout le projet d'une version + assertion d'accès (RBAC) → renvoie le projectId. */
async function resolveVersionAccess(req: Request, id: number): Promise<number> {
  const projectId = await resolveProjectIdForVersion(id);
  if (!projectId) throw notFound('Version not found');
  await assertProjectAccess(req, projectId);
  return projectId;
}

// GET /api/versions/:id/reviewers — qui doit regarder cette version (membres du projet)
router.get('/versions/:id/reviewers', auth, validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  await resolveVersionAccess(req, id);
  res.json({ reviewers: await ReviewAssignmentService.listReviewers(id) });
});

/**
 * PUT /api/versions/:id/reviewers — confie la review à ces personnes, consignes comprises.
 *
 * Le droit se lit sur le rôle EFFECTIF du projet (38.E), asserté par le service : un
 * superviseur nommé sur le projet doit pouvoir répartir ses reviews, un administrateur de
 * passage aussi, et le rôle global du compte ne dit ni l'un ni l'autre. L'auteur de la
 * version y a droit aussi — c'est lui qui sait ce qu'il vient de livrer.
 */
router.put(
  '/versions/:id/reviewers',
  auth,
  validate({ params: idParam, body: z.object({ reviewers: ReviewAssignmentService.reviewersSchema }) }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await resolveVersionAccess(req, id);
    const reviewers = await ReviewAssignmentService.setReviewers(
      req.user!,
      projectId,
      id,
      req.body.reviewers,
    );
    res.json({ reviewers });
  },
);

/**
 * PATCH /api/versions/:id/reviewers/:userId — réécrit la consigne d'une seule personne.
 *
 * Le geste d'après-coup, « ajoute-lui ce qu'il faut regarder » : renvoyer la liste entière
 * pour changer une phrase aurait obligé l'écran à la relire, et deux écrans ouverts se
 * seraient effacés l'un l'autre.
 */
router.patch(
  '/versions/:id/reviewers/:userId',
  auth,
  validate({
    params: idParam.extend({ userId: z.coerce.number().int().positive() }),
    body: z.object({ note: reviewNoteSchema }),
  }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await resolveVersionAccess(req, id);
    const reviewers = await ReviewAssignmentService.updateNote(
      req.user!,
      projectId,
      id,
      Number(req.params.userId),
      req.body.note ?? null,
    );
    res.json({ reviewers });
  },
);

export default router;
