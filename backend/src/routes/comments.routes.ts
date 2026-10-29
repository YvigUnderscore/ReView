// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router, type Request } from 'express';
import { CommentState } from '@prisma/client';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { assertProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { resolveProjectIdForMedia, resolveProjectIdForComment } from '../lib/pipeline';
import { notFound } from '../lib/errors';
import { paginationQuery, readPagination } from '../lib/pagination';
import { annotationSchema, cameraStateSchema } from '../lib/commentPayload';
import { attachmentsSchema } from '../lib/commentAttachments';
import { commentTaskBody } from '../lib/taskPayload';
import { rateLimit, identityRateKey } from '../middleware/rateLimit';
import * as CommentService from '../services/CommentService';
import * as CommentExportService from '../services/CommentExportService';
import * as TaskService from '../services/TaskService';

const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int() });

/** Resolves a comment's project and access assertion (RBAC), returns the projectId. */
async function resolveCommentAccess(req: Request, commentId: number): Promise<number> {
  const projectId = await resolveProjectIdForComment(commentId);
  if (!projectId) throw notFound('Comment not found');
  await assertProjectAccess(req, projectId);
  return projectId;
}

// GET /api/comments?mediaObjectId=X — thread (paginated roots and replies) of a media (10.D1)
router.get(
  '/',
  validate({ query: z.object({ mediaObjectId: z.coerce.number().int() }).merge(paginationQuery) }),
  async (req, res) => {
    const mediaObjectId = Number(req.query.mediaObjectId);
    const projectId = await resolveProjectIdForMedia(mediaObjectId);
    if (!projectId) throw notFound('Media not found');
    await assertProjectAccess(req, projectId);
    res.json(await CommentService.listThread(mediaObjectId, readPagination(req.query), req.user!.role));
  },
);

// GET /api/comments/export?scope=&id=&format= — notes export: CSV for production, EDL/OTIO for editing,
// printable sheet. Declared before `/:id` ("export" is not one).
router.get(
  '/export',
  rateLimit({ windowMs: 60_000, max: 20, keyGenerator: identityRateKey }),
  validate({
    query: z.object({
      scope: z.enum(['media', 'version', 'shot', 'playlist', 'timeline']),
      id: z.coerce.number().int().positive(),
      format: z.enum(['csv', 'edl', 'otio', 'sheet']),
    }),
  }),
  async (req, res) => {
    const scope = req.query.scope as unknown as CommentExportService.NotesScope;
    const format = req.query.format as unknown as CommentExportService.NotesFormat;
    const id = Number(req.query.id);
    const projectId = await CommentExportService.resolveScopeProject(scope, id);
    if (projectId === null) throw notFound('Nothing to export here');
    await assertProjectAccess(req, projectId);
    const file = await CommentExportService.exportNotes({ scope, id, format, viewer: req.user! });
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    if (file.truncated) res.setHeader('X-Notes-Truncated', '1');
    res.send(file.body);
  },
);

// POST /api/comments/attachments/presign — presigned URL for an attachment to the thread
// (images as thumbnails; PDF/zip/text as chips; audio = voice notes played inline, 32.F;
// octet-stream = blobs of a cloud edit proposal, cf. `lib/commentSplatEdit`)
router.post(
  '/attachments/presign',
  validate({
    body: z.object({
      filename: z.string().min(1).max(200),
      contentType: z
        .string()
        .regex(
          /^(image\/(png|jpe?g|webp|gif)|application\/(pdf|zip|octet-stream)|text\/plain|audio\/(webm|ogg|mp4|mpeg|wav))(;.*)?$/,
        ),
    }),
  }),
  async (req, res) => {
    const { filename, contentType } = req.body as { filename: string; contentType: string };
    res.json(await CommentService.presignAttachment(req.user!.id, filename, contentType));
  },
);

// POST /api/comments — review comment (video: timestamp; 3D: cameraState; image: annotation)
router.post(
  '/',
  validate({
    body: z.object({
      mediaObjectId: z.number().int(),
      content: z.string().min(1).max(10000),
      timestamp: z.number().nonnegative().optional(),
      duration: z.number().nonnegative().optional(),
      // Bounded in SHAPE and in VOLUME: as `z.any()`, their only ceiling was the 2 MB of the body.
      annotation: annotationSchema.optional(),
      cameraState: cameraStateSchema.optional(),
      attachments: attachmentsSchema.optional(),
      parentId: z.number().int().optional(),
      // Written feedback posted from an edit (46): it belongs to that edit until an explicit re-share.
      timelineId: z.number().int().optional(),
      timelineTime: z.number().nonnegative().optional(),
    }),
  }),
  async (req, res) => {
    const projectId = await resolveProjectIdForMedia(req.body.mediaObjectId);
    if (!projectId) throw notFound('Media not found');
    await assertProjectAccess(req, projectId);
    res.status(201).json({ comment: await CommentService.create(req.user!, projectId, req.body) });
  },
);

// POST /api/comments/:id/share — returns an edit's feedback to the shot's review (46)
router.post('/:id/share', validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  const projectId = await resolveCommentAccess(req, id);
  const comment = await CommentService.share(req.user!, projectId, id);
  if (!comment) throw notFound('Comment not found');
  res.json({ comment });
});

// PATCH /api/comments/:id — edit (author), resolution, client visibility + assignment (supervisor+)
router.patch(
  '/:id',
  validate({
    params: idParam,
    body: z.object({
      content: z.string().min(1).max(10000).optional(),
      // Full list of the attachments after editing (D5): absent means unchanged. The service
      // re-filters the keys: this schema bounds the shape, not the ownership.
      attachments: attachmentsSchema.optional(),
      // Full list of the annotation strokes after editing (3D eraser, Phase 50): same contract as the
      // attachments, and reserved to the author by the service.
      annotation: annotationSchema.optional(),
      // Thread state (D1); `isResolved` remains accepted for API v1 and older clients.
      state: z.nativeEnum(CommentState).optional(),
      isResolved: z.boolean().optional(),
      isVisibleToClient: z.boolean().optional(),
      assigneeId: z.number().int().nullable().optional(),
    }),
  }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await resolveCommentAccess(req, id);
    const comment = await CommentService.update(req.user!, projectId, id, req.body);
    if (!comment) throw notFound('Comment not found');
    res.json({ comment });
  },
);

// DELETE /api/comments/:id — author or supervisor/admin
router.delete('/:id', validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  const projectId = await resolveCommentAccess(req, id);
  if (!(await CommentService.remove(req.user!, projectId, id))) throw notFound('Comment not found');
  res.status(204).end();
});

// POST /api/comments/:id/task — kanban task from the comment (32.D): name and brief come from the
// creation dialog. The rights are asserted by the service, on the project's EFFECTIVE role: they were
// read here on the GLOBAL role, which refused a supervisor named on THIS project a creation that the
// service grants them.
router.post('/:id/task', validate({ params: idParam, body: commentTaskBody }), async (req, res) => {
  const id = Number(req.params.id);
  const projectId = await resolveCommentAccess(req, id);
  res.status(201).json({ task: await TaskService.createFromComment(req.user!, projectId, id, req.body) });
});

// POST /api/comments/:id/reactions — add or update an emoji reaction
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

// DELETE /api/comments/:id/reactions/:emoji — remove a reaction
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
