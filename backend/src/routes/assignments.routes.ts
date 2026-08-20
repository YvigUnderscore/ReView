// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as AssignmentService from '../services/AssignmentService';

/**
 * Assignation d'une personne sur un asset ou un plan.
 *
 * L'écriture porte sur les tâches de l'entité, jamais sur l'entité elle-même — voir
 * `AssignmentService` pour le pourquoi. Les droits sont vérifiés dans le service, sur le
 * projet résolu : un superviseur de projet dont le compte est ARTIST doit pouvoir le faire,
 * ce qu'un `requireRole` sur le rôle global lui refuserait.
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

export default router;
