import { Router, type Request } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { assertProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { resolveProjectIdForMedia, resolveProjectIdForComment } from '../lib/pipeline';
import { notFound } from '../lib/errors';
import * as CommentService from '../services/CommentService';

const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int() });

/** Résout le projet d'un commentaire + assertion d'accès (RBAC) → renvoie le projectId. */
async function resolveCommentAccess(req: Request, commentId: number): Promise<number> {
  const projectId = await resolveProjectIdForComment(commentId);
  if (!projectId) throw notFound('Commentaire introuvable');
  await assertProjectAccess(req, projectId);
  return projectId;
}

// GET /api/comments?mediaObjectId=X — fil de commentaires (racines + réponses) d'un média
router.get(
  '/',
  validate({ query: z.object({ mediaObjectId: z.coerce.number().int() }) }),
  async (req, res) => {
    const mediaObjectId = Number(req.query.mediaObjectId);
    const projectId = await resolveProjectIdForMedia(mediaObjectId);
    if (!projectId) throw notFound('Média introuvable');
    await assertProjectAccess(req, projectId);
    res.json({ comments: await CommentService.listThread(mediaObjectId) });
  },
);

// POST /api/comments/attachments/presign — URL présignée pour une image jointe au fil
router.post(
  '/attachments/presign',
  validate({
    body: z.object({
      filename: z.string().min(1).max(200),
      contentType: z.string().regex(/^image\/(png|jpe?g|webp|gif)$/),
    }),
  }),
  async (req, res) => {
    const { filename, contentType } = req.body as { filename: string; contentType: string };
    res.json(await CommentService.presignAttachment(req.user!.id, filename, contentType));
  },
);

// POST /api/comments — commentaire de review (vidéo: timestamp ; 3D: cameraState ; image: annotation)
router.post(
  '/',
  validate({
    body: z.object({
      mediaObjectId: z.number().int(),
      content: z.string().min(1).max(10000),
      timestamp: z.number().nonnegative().optional(),
      duration: z.number().nonnegative().optional(),
      annotation: z.any().optional(),
      cameraState: z.any().optional(),
      attachments: z
        .array(
          z.object({
            key: z.string().max(512),
            name: z.string().max(200).optional(),
            contentType: z.string().max(100).optional(),
          }),
        )
        .max(8)
        .optional(),
      parentId: z.number().int().optional(),
    }),
  }),
  async (req, res) => {
    const projectId = await resolveProjectIdForMedia(req.body.mediaObjectId);
    if (!projectId) throw notFound('Média introuvable');
    await assertProjectAccess(req, projectId);
    res.status(201).json({ comment: await CommentService.create(req.user!, projectId, req.body) });
  },
);

// PATCH /api/comments/:id — édition (auteur), résolution, visibilité client + assignation (superviseur+)
router.patch(
  '/:id',
  validate({
    params: idParam,
    body: z.object({
      content: z.string().min(1).max(10000).optional(),
      isResolved: z.boolean().optional(),
      isVisibleToClient: z.boolean().optional(),
      assigneeId: z.number().int().nullable().optional(),
    }),
  }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await resolveCommentAccess(req, id);
    const comment = await CommentService.update(req.user!, projectId, id, req.body);
    if (!comment) throw notFound('Commentaire introuvable');
    res.json({ comment });
  },
);

// DELETE /api/comments/:id — auteur ou superviseur/admin
router.delete('/:id', validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  const projectId = await resolveCommentAccess(req, id);
  if (!(await CommentService.remove(req.user!, projectId, id))) throw notFound('Commentaire introuvable');
  res.status(204).end();
});

// POST /api/comments/:id/reactions — ajoute/maj une réaction emoji
router.post(
  '/:id/reactions',
  validate({ params: idParam, body: z.object({ emoji: z.string().min(1).max(16) }) }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await resolveCommentAccess(req, id);
    const reaction = await CommentService.addReaction(req.user!, projectId, id, req.body.emoji);
    res.status(201).json({ reaction });
  },
);

// DELETE /api/comments/:id/reactions/:emoji — retire une réaction
router.delete(
  '/:id/reactions/:emoji',
  validate({ params: z.object({ id: z.coerce.number().int(), emoji: z.string().min(1).max(16) }) }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await resolveCommentAccess(req, id);
    await CommentService.removeReaction(req.user!.id, projectId, id, String(req.params.emoji));
    res.status(204).end();
  },
);

export default router;
