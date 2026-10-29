// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { validate } from '../../middleware/validate';
import { requireScope } from '../../middleware/scope';
import { readPagination, pageArgs, paginate } from '../../lib/pagination';
import { commentSelect, toComment } from '../../lib/v1Resources';
import * as CommentService from '../../services/CommentService';
import * as ApiEventService from '../../services/ApiEventService';
import { idParam, requireMediaProject, requireVersionProject, readQuery } from './helpers';

/**
 * Review comments (API v1): read and post.
 *
 * This is the surface a bot uses: relaying review notes into a team channel, or posting
 * feedback written elsewhere. Graphic annotations and attachments stay out of this API: they
 * require file uploads and image geometry that only the UI produces correctly.
 */
const router = Router();

const commentsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(100),
  resolved: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

// GET /api/v1/media/:id/comments: thread of a media
router.get(
  '/media/:id/comments',
  requireScope('comments:read'),
  validate({ params: idParam, query: commentsQuery }),
  async (req, res) => {
    const mediaId = Number(req.params.id);
    await requireMediaProject(req, mediaId);
    const p = readPagination(req.query);
    // Typed re-read: without it, `resolved=false` would remain the string "false".
    const { resolved } = readQuery(commentsQuery, req);
    const where = {
      mediaObjectId: mediaId,
      ...(resolved !== undefined ? { isResolved: resolved } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.comment.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        ...pageArgs(p),
        select: commentSelect,
      }),
      prisma.comment.count({ where }),
    ]);
    res.json(paginate(rows.map(toComment), total, p));
  },
);

// POST /api/v1/media/:id/comments: post a note
router.post(
  '/media/:id/comments',
  requireScope('comments:write'),
  validate({
    params: idParam,
    body: z.object({
      content: z.string().trim().min(1).max(10_000),
      /** Position in the video, in seconds. */
      timestamp: z.number().nonnegative().optional(),
      duration: z.number().nonnegative().optional(),
      parentId: z.number().int().positive().optional(),
    }),
  }),
  async (req, res) => {
    const mediaId = Number(req.params.id);
    const projectId = await requireMediaProject(req, mediaId);
    const body = req.body as Omit<CommentService.CreateCommentInput, 'mediaObjectId'>;
    const comment = await CommentService.create(req.user!, projectId, {
      ...body,
      mediaObjectId: mediaId,
    });
    res.status(201).json({ comment });
  },
);

// GET /api/v1/versions/:id/comments: all comments of a version, across its media
router.get(
  '/versions/:id/comments',
  requireScope('comments:read'),
  validate({ params: idParam }),
  async (req, res) => {
    const versionId = Number(req.params.id);
    await requireVersionProject(req, versionId);
    const rows = await prisma.comment.findMany({
      where: { media: { versionId, deletedAt: null } },
      orderBy: { createdAt: 'asc' },
      select: commentSelect,
    });
    res.json({ comments: rows.map(toComment) });
  },
);

// POST /api/v1/comments/:id/resolve: close a note (retake status handled)
router.post(
  '/comments/:id/resolve',
  requireScope('comments:write'),
  validate({
    params: idParam,
    body: z.object({ resolved: z.boolean().default(true) }),
  }),
  async (req, res) => {
    const id = Number(req.params.id);
    const comment = await prisma.comment.findUnique({
      where: { id },
      select: { mediaObjectId: true },
    });
    if (!comment) {
      res.status(404).json({ error: 'Comment not found' });
      return;
    }
    const projectId = await requireMediaProject(req, comment.mediaObjectId);
    const resolved = (req.body as { resolved: boolean }).resolved;
    const updated = await prisma.comment.update({
      where: { id },
      data: {
        isResolved: resolved,
        resolvedById: resolved ? req.user!.id : null,
        resolvedAt: resolved ? new Date() : null,
      },
      select: commentSelect,
    });
    if (resolved) {
      ApiEventService.publish('comment.resolved', {
        projectId,
        entityType: 'comment',
        entityId: id,
        actorId: req.user!.id,
        payload: { comment: toComment(updated) },
      });
    }
    res.json({ comment: toComment(updated) });
  },
);

export default router;
