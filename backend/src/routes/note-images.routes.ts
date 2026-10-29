// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { assertProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { assertProjectWritable } from '../lib/projectGuard';
import { assertProjectManage } from '../lib/projectRoles';
import { resolveProject, type NoteKind } from '../services/EntityNoteService';
import * as NoteImages from '../services/EntityNoteImageService';

/**
 * Images uploaded into an entity's sheet, mounted on `/api`.
 *
 * Two steps, as everywhere else: an upload URL is requested, the browser uploads directly to MinIO, and
 * the sheet only records the key. Reading goes through `resolve`: a presigned URL expires, a key does not.
 */
const router = Router();

/** ⚠ Mounted on `/api`: authentication route by route, never `router.use`. */
const auth = authenticate;

const SEGMENTS = {
  episodes: 'episode',
  sequences: 'sequence',
  shots: 'shot',
  assets: 'asset',
} as const satisfies Record<string, NoteKind>;

const idParam = z.object({ id: z.coerce.number().int().positive() });

const presignBody = z.object({
  filename: z.string().min(1).max(200),
  contentType: z.string().regex(/^image\/(png|jpe?g|webp|gif|avif)$/),
});

for (const [segment, kind] of Object.entries(SEGMENTS) as [keyof typeof SEGMENTS, NoteKind][]) {
  router.post(
    `/${segment}/:id/note/images/presign`,
    auth,
    validate({ params: idParam, body: presignBody }),
    async (req, res) => {
      const id = Number(req.params.id);
      const projectId = await resolveProject(kind, id);
      await assertProjectAccess(req, projectId);
      // Uploading an image is writing the sheet: same right, same archive guard.
      await assertProjectWritable(projectId);
      await assertProjectManage(req.user!.id, req.user!.role, projectId);
      res.json(await NoteImages.presign(kind, id, req.body.filename, req.body.contentType));
    },
  );
}

/**
 * The read URLs of a batch of keys.
 *
 * POST rather than GET: a board carries dozens of keys, and stacking them into a query string would
 * truncate them without warning.
 */
router.post(
  '/note-images/resolve',
  auth,
  validate({
    body: z.object({
      keys: z.array(z.string().max(512)).max(NoteImages.MAX_RESOLVE_KEYS),
    }),
  }),
  async (req, res) => {
    res.json({ urls: await NoteImages.resolveMany(req.user!, req.body.keys) });
  },
);

export default router;
