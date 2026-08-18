// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { requireRole, assertProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { assertProjectWritable } from '../lib/projectGuard';
import * as EntityThumbnailService from '../services/EntityThumbnailService';

/**
 * Vignette d'une séquence, d'un plan ou d'un asset (C3) — monté sur `/api`.
 *
 * Deux temps, comme pour un avatar : on demande une URL de dépôt, on téléverse
 * directement vers MinIO, puis on enregistre la clé. La clé est calculée ici et non
 * reçue du client, et l'enregistrement la revérifie : le PATCH d'asset accepte
 * `thumbnailKey` depuis longtemps, et rien n'empêchait d'y écrire la clé d'un média
 * appartenant à un projet auquel on n'a pas accès.
 */
const router = Router();

/**
 * ⚠ Ce routeur est monté sur `/api` (il porte plusieurs préfixes) : un `router.use(authenticate)`
 * s'appliquerait à **toute** requête traversant ce point de montage, routes publiques
 * comprises — le partage client répondait 401 au lieu de servir la page. L'authentification
 * est donc posée route par route.
 */
const auth = authenticate;

const manage = requireRole(Role.ADMIN, Role.SUPERVISOR);
const idParam = z.object({ id: z.coerce.number().int().positive() });
const contentTypeBody = z.object({ contentType: z.string().regex(/^image\/(png|jpe?g|webp)$/) });
const keyBody = z.object({ key: z.string().max(512).nullable() });

for (const [segment, holder] of [
  ['sequences', 'sequence'],
  ['shots', 'shot'],
  ['assets', 'asset'],
] as const) {
  router.post(
    `/${segment}/:id/thumbnail/presign`,
    auth,
    manage,
    validate({ params: idParam, body: contentTypeBody }),
    async (req, res) => {
      const id = Number(req.params.id);
      const projectId = await EntityThumbnailService.resolveProject(holder, id);
      await assertProjectAccess(req, projectId);
      await assertProjectWritable(projectId); // 38.B : projet archivé = lecture seule
      res.json(await EntityThumbnailService.presign(holder, id, req.body.contentType));
    },
  );

  router.put(
    `/${segment}/:id/thumbnail`,
    auth,
    manage,
    validate({ params: idParam, body: keyBody }),
    async (req, res) => {
      const id = Number(req.params.id);
      const projectId = await EntityThumbnailService.resolveProject(holder, id);
      await assertProjectAccess(req, projectId);
      await assertProjectWritable(projectId);
      res.json({ thumbnailKey: await EntityThumbnailService.set(holder, id, req.body.key) });
    },
  );
}

export default router;
