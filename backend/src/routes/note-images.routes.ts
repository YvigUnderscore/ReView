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
 * Les images déposées dans une fiche d'entité — monté sur `/api`.
 *
 * Deux temps, comme partout ailleurs : on demande une URL de dépôt, le navigateur téléverse
 * directement vers MinIO, et la fiche n'enregistre que la clé. La relecture passe par
 * `resolve` : une URL présignée expire, une clé non.
 */
const router = Router();

/** ⚠ Monté sur `/api` : authentification route par route, jamais `router.use`. */
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
      // Déposer une image, c'est écrire la fiche : même droit, même garde d'archivage.
      await assertProjectWritable(projectId);
      await assertProjectManage(req.user!.id, req.user!.role, projectId);
      res.json(await NoteImages.presign(kind, id, req.body.filename, req.body.contentType));
    },
  );
}

/**
 * Les URL de lecture d'un lot de clés.
 *
 * En POST plutôt qu'en GET : une planche porte des dizaines de clés, et les empiler dans
 * une chaîne de requête les tronquerait sans prévenir.
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
