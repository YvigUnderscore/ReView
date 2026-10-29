// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { MediaKind } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { paginationQuery, readPagination } from '../lib/pagination';
import { reviewNoteSchema } from '../lib/projectSettings';
import { reviewersSchema } from '../services/ReviewAssignmentService';
import * as MediaService from '../services/MediaService';

const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int() });

// POST /api/media/upload-url (simple presigned PUT): moved to media-upload.routes.ts (37.A).

/**
 * POST /api/media/:id/finalize: called after the PUT. Reads the header from MinIO, validates the magic
 * bytes, updates the size and triggers the processing. `note` = upload note (P50).
 */
const finalizeBody = z.object({ note: reviewNoteSchema }).prefault({});
router.post('/:id/finalize', validate({ params: idParam, body: finalizeBody }), async (req, res) => {
  res.json(await MediaService.finalize(req.user!, Number(req.params.id), req.body.note));
});

/**
 * GET /api/media?projectId=X[&kind=IMAGE]: published (READY) media of a project.
 * Library for insertion onto the mood/reference board. Members only.
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
 * GET /api/media/reviews: the global "Reviews" page (12.C): published media of my projects plus my
 * drafts, filtered by project, type and status, sorted by recency, paginated.
 */
router.get(
  '/reviews',
  validate({
    query: z
      .object({
        projectId: z.coerce.number().int().optional(),
        kind: z.nativeEnum(MediaKind).optional(),
        status: z.enum(['published', 'draft']).optional(),
        // Filter by review decision (Phase 31): status id or 'none' (no decision)
        decision: z.union([z.coerce.number().int(), z.literal('none')]).optional(),
        // Reviews entrusted to me (Phase 49): what the "Assigned to me" panel reads.
        assigned: z.literal('me').optional(),
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
          assigned: q.assigned as 'me' | undefined,
        },
        readPagination(q),
      ),
    );
  },
);

/** POST /api/media/:id/publish: publishes a draft media (reserved to the uploader). */
router.post(
  '/:id/publish',
  // The upload gesture: publish WHILE SAYING who must look at what; a missing note then refuses the
  // publication. Returns `{ media, reviewers }`. Absent body means publish without entrusting anyone,
  // as before: without `.prefault({})`, a POST without a body would be refused.
  validate({ params: idParam, body: z.object({ reviewers: reviewersSchema.optional() }).prefault({}) }),
  async (req, res) => {
    res.json(await MediaService.publish(req.user!, Number(req.params.id), req.body.reviewers));
  },
);

/**
 * GET /api/media/drafts: drafts (unpublished) of the current user.
 */
router.get('/drafts', async (req, res) => {
  res.json({ drafts: await MediaService.listDrafts(req.user!.id) });
});

/**
 * POST /api/media/:id/reprocess: re-runs the processing job of a failed or blocked media.
 */
router.post('/:id/reprocess', validate({ params: idParam }), async (req, res) => {
  res.json(await MediaService.reprocess(req.user!, Number(req.params.id)));
});

/**
 * POST /api/media/:id/thumbnail: records a thumbnail captured client-side (Three.js rendering for
 * splat and 3D; no server-side headless rendering). Base64 image data URL.
 */
router.post(
  '/:id/thumbnail',
  validate({ params: idParam, body: z.object({ dataUrl: z.string().min(1).max(1_600_000) }) }),
  async (req, res) => {
    res.json(await MediaService.setThumbnail(req.user!, Number(req.params.id), req.body.dataUrl));
  },
);

/**
 * POST /api/media/:id/auto-thumbnail: automatic thumbnail captured at the first view of a 3D or splat
 * media. Idempotent bootstrap (writes only if `thumbnailKey` is absent), read access (any project member).
 */
router.post(
  '/:id/auto-thumbnail',
  validate({ params: idParam, body: z.object({ dataUrl: z.string().min(1).max(1_600_000) }) }),
  async (req, res) => {
    res.json(await MediaService.setAutoThumbnail(req.user!, Number(req.params.id), req.body.dataUrl));
  },
);

/**
 * GET /api/media/:id: full media object plus presigned URLs (original, thumbnail, proxy).
 * Splat edits (transform, volumes, mask) live in media-splat.routes.ts (10.G).
 */
router.get('/:id', validate({ params: idParam }), async (req, res) => {
  res.json(await MediaService.getDetail(req.user!, Number(req.params.id), req.ip));
});

/**
 * GET /api/media/:id/url: presigned GET URL for direct serving from MinIO.
 */
router.get('/:id/url', validate({ params: idParam }), async (req, res) => {
  res.json({ url: await MediaService.getUrl(req.user!, Number(req.params.id)) });
});

/**
 * GET /api/media/:id/hls/:file: HLS manifests (Phase 23, revised in wave 2: the segments no longer go
 * through Node, cf. MediaService). The master pays the authorization in the database; `pt` is the read
 * token it issued, which exempts the sub-playlists from it. `file` is restricted (neither `/` nor query)
 * and re-validated on the service side. The cache is decided by the service: never for a manifest (token
 * and signed URLs), immutable for a segment served as a fallback.
 */
router.get(
  '/:id/hls/:file',
  validate({
    params: z.object({ id: z.coerce.number().int(), file: z.string().regex(/^[A-Za-z0-9._-]+$/) }),
    query: z.object({ pt: z.string().max(2048).optional() }),
  }),
  async (req, res) => {
    const out = await MediaService.getHlsFile(req.user!, Number(req.params.id), String(req.params.file), {
      playbackToken: req.query.pt as string | undefined,
      ip: req.ip,
    });
    res.setHeader('Content-Type', out.contentType);
    res.setHeader('Cache-Control', out.cacheControl);
    if (out.body !== undefined) {
      res.send(out.body);
      return;
    }
    out.stream?.on('error', () => res.destroy());
    out.stream?.pipe(res);
  },
);

// DELETE /api/media/:id — trash (soft delete, uploader or supervisor and above)
router.delete('/:id', validate({ params: idParam }), async (req, res) => {
  await MediaService.trash(req.user!, Number(req.params.id));
  res.status(204).end();
});

// POST /api/media/:id/restore (uploader or supervisor and above)
router.post('/:id/restore', validate({ params: idParam }), async (req, res) => {
  await MediaService.restore(req.user!, Number(req.params.id));
  res.status(204).end();
});

// DELETE /api/media/:id/purge — permanent deletion from DB + MinIO (supervisor and above)
router.delete('/:id/purge', validate({ params: idParam }), async (req, res) => {
  await MediaService.purge(req.user!, Number(req.params.id));
  res.status(204).end();
});

export default router;
