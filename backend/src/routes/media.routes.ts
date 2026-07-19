import { Router } from 'express';
import { z } from 'zod';
import { MediaKind } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { paginationQuery, readPagination } from '../lib/pagination';
import * as MediaService from '../services/MediaService';

const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int() });

// POST /api/media/upload-url (PUT présigné simple) : déplacé dans media-upload.routes.ts (37.A).

/**
 * POST /api/media/:id/finalize — appelé après le PUT : lit l'en-tête depuis MinIO,
 * valide les magic bytes, met la taille à jour et déclenche le traitement.
 */
router.post('/:id/finalize', validate({ params: idParam }), async (req, res) => {
  res.json(await MediaService.finalize(req.user!, Number(req.params.id)));
});

/**
 * GET /api/media?projectId=X[&kind=IMAGE] — médias publiés (READY) d'un projet.
 * Bibliothèque pour l'insertion sur le board mood/reference. Membres uniquement.
 */
router.get(
  '/',
  validate({
    query: z
      .object({ projectId: z.coerce.number().int(), kind: z.nativeEnum(MediaKind).optional() })
      .merge(paginationQuery),
  }),
  async (req, res) => {
    res.json(
      await MediaService.listPublished(
        req.user!,
        Number(req.query.projectId),
        req.query.kind as MediaKind | undefined,
        readPagination(req.query),
      ),
    );
  },
);

/**
 * GET /api/media/reviews — page « Reviews » globale (12.C) : médias publiés de mes
 * projets + mes brouillons, filtres projet/type/statut, tri récent, paginé.
 */
router.get(
  '/reviews',
  validate({
    query: z
      .object({
        projectId: z.coerce.number().int().optional(),
        kind: z.nativeEnum(MediaKind).optional(),
        status: z.enum(['published', 'draft']).optional(),
        // Filtre par décision de review (Phase 31) : id de statut ou 'none' (sans décision)
        decision: z.union([z.coerce.number().int(), z.literal('none')]).optional(),
      })
      .merge(paginationQuery),
  }),
  async (req, res) => {
    const q = req.query;
    res.json(
      await MediaService.listReviews(
        req.user!,
        {
          projectId: q.projectId ? Number(q.projectId) : undefined,
          kind: q.kind as MediaKind | undefined,
          status: q.status as 'published' | 'draft' | undefined,
          decision: q.decision === 'none' ? 'none' : q.decision ? Number(q.decision) : undefined,
        },
        readPagination(q),
      ),
    );
  },
);

/**
 * POST /api/media/:id/publish — publie un média brouillon (réservé à l'uploader).
 */
router.post('/:id/publish', validate({ params: idParam }), async (req, res) => {
  res.json({ media: await MediaService.publish(req.user!, Number(req.params.id)) });
});

/**
 * GET /api/media/drafts — brouillons (non publiés) de l'utilisateur courant.
 */
router.get('/drafts', async (req, res) => {
  res.json({ drafts: await MediaService.listDrafts(req.user!.id) });
});

/**
 * POST /api/media/:id/reprocess — relance le job de traitement d'un média en échec/bloqué.
 */
router.post('/:id/reprocess', validate({ params: idParam }), async (req, res) => {
  res.json(await MediaService.reprocess(req.user!, Number(req.params.id)));
});

/**
 * POST /api/media/:id/thumbnail — enregistre une miniature capturée côté client
 * (rendu Three.js pour splat/3D — pas de rendu headless serveur). Data URL image base64.
 */
router.post(
  '/:id/thumbnail',
  validate({ params: idParam, body: z.object({ dataUrl: z.string().min(1).max(1_600_000) }) }),
  async (req, res) => {
    res.json(await MediaService.setThumbnail(req.user!, Number(req.params.id), req.body.dataUrl));
  },
);

/**
 * POST /api/media/:id/auto-thumbnail — miniature auto capturée à la 1re vue d'un média 3D/splat.
 * Bootstrap idempotent (n'écrit que si `thumbnailKey` absent), accès lecture (tout membre projet).
 */
router.post(
  '/:id/auto-thumbnail',
  validate({ params: idParam, body: z.object({ dataUrl: z.string().min(1).max(1_600_000) }) }),
  async (req, res) => {
    res.json(await MediaService.setAutoThumbnail(req.user!, Number(req.params.id), req.body.dataUrl));
  },
);

/**
 * GET /api/media/:id — objet média complet + URLs présignées (original, miniature, proxy).
 * Les éditions splat (transform/volumes/masque) vivent dans media-splat.routes.ts (10.G).
 */
router.get('/:id', validate({ params: idParam }), async (req, res) => {
  res.json(await MediaService.getDetail(req.user!, Number(req.params.id), req.ip));
});

/**
 * GET /api/media/:id/url — URL présignée GET pour le serving direct depuis MinIO.
 */
router.get('/:id/url', validate({ params: idParam }), async (req, res) => {
  res.json({ url: await MediaService.getUrl(req.user!, Number(req.params.id)) });
});

/**
 * GET /api/media/:id/hls/:file — proxy des fichiers HLS (master/rendition/segment) depuis MinIO
 * (Phase 23). `file` restreint (pas de `/` ni `..`) ; accès lecture re-vérifié dans le service.
 */
router.get(
  '/:id/hls/:file',
  validate({
    params: z.object({ id: z.coerce.number().int(), file: z.string().regex(/^[A-Za-z0-9._-]+$/) }),
  }),
  async (req, res) => {
    const { stream, contentType } = await MediaService.getHlsFile(
      req.user!,
      Number(req.params.id),
      String(req.params.file),
    );
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=60');
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  },
);

// DELETE /api/media/:id — corbeille (soft-delete, uploader ou superviseur+)
router.delete('/:id', validate({ params: idParam }), async (req, res) => {
  await MediaService.trash(req.user!, Number(req.params.id));
  res.status(204).end();
});

// POST /api/media/:id/restore (uploader ou superviseur+)
router.post('/:id/restore', validate({ params: idParam }), async (req, res) => {
  await MediaService.restore(req.user!, Number(req.params.id));
  res.status(204).end();
});

// DELETE /api/media/:id/purge — suppression définitive DB + MinIO (superviseur+)
router.delete('/:id/purge', validate({ params: idParam }), async (req, res) => {
  await MediaService.purge(req.user!, Number(req.params.id));
  res.status(204).end();
});

export default router;
