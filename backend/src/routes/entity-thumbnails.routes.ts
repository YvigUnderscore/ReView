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
 * Thumbnail of a sequence, a shot or an asset (C3), mounted on `/api`.
 *
 * Two steps, as for an avatar: request an upload URL, upload directly to MinIO, then record the key.
 * The key is computed here and not received from the client, and the recording re-verifies it: the
 * asset PATCH has long accepted `thumbnailKey`, and nothing prevented writing into it the key of a media
 * belonging to a project one has no access to.
 */
const router = Router();

/**
 * ⚠ This router is mounted on `/api` (it carries several prefixes): a `router.use(authenticate)` would
 * apply to **every** request crossing this mount point, public routes included: client sharing would
 * answer 401 instead of serving the page. Authentication is therefore set route by route.
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
      await assertProjectWritable(projectId); // 38.B: archived project = read-only
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
