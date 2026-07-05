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

/**
 * POST /api/media/upload-url — crée un MediaObject (UPLOADING) + URL présignée PUT
 * pour uploader directement dans MinIO (non-bloquant, sans toucher le FS serveur).
 */
router.post(
  '/upload-url',
  validate({
    body: z.object({
      versionId: z.number().int(),
      filename: z.string().min(1).max(255),
      contentType: z.string().min(1).max(160),
      kind: z.nativeEnum(MediaKind),
      size: z.number().int().nonnegative().optional(),
    }),
  }),
  async (req, res) => {
    res.status(201).json(await MediaService.createUpload(req.user!, req.body));
  },
);

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
 * GET /api/media/:id — objet média complet + URLs présignées (original, miniature, proxy).
 */
router.get('/:id', validate({ params: idParam }), async (req, res) => {
  res.json(await MediaService.getDetail(req.user!, Number(req.params.id)));
});

/**
 * GET /api/media/:id/url — URL présignée GET pour le serving direct depuis MinIO.
 */
router.get('/:id/url', validate({ params: idParam }), async (req, res) => {
  res.json({ url: await MediaService.getUrl(req.user!, Number(req.params.id)) });
});

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
