// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { MediaKind } from '@prisma/client';
import { authenticate, requireUser } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as MediaUploadService from '../services/MediaUploadService';
import * as MediaService from '../services/MediaService';
import * as ImageSequenceService from '../services/ImageSequenceService';
import { FRAME_NAME_MAX_LENGTH, MAX_SEQUENCE_FRAMES, MIN_SEQUENCE_FRAMES } from '../lib/imageSequence';
import { reviewNoteSchema } from '../lib/projectSettings';

/**
 * Resumable multipart upload (37.A/37.B) and image sequence uploads (wave 5), mounted under /api/media
 * BEFORE media.routes (otherwise `/multipart/...` and `/sequence/...` would match `/:id`). The simple
 * upload (presigned PUT) remains in media.routes for small files.
 */
const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int() });
const sha256 = z
  .string()
  .regex(/^[0-9a-f]{64}$/i)
  .transform((s) => s.toLowerCase());

/**
 * POST /api/media/upload-url: simple upload (presigned PUT) for small files: creates a MediaObject
 * (UPLOADING) plus a presigned URL, without touching the server's filesystem.
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
      contentHash: sha256.optional(), // client sha256 (37.B), verified by the worker
    }),
  }),
  async (req, res) => {
    res.status(201).json(await MediaService.createUpload(requireUser(req), req.body));
  },
);

// POST /api/media/multipart/init — creates (or retrieves) the upload; deduplicated by hash
router.post(
  '/multipart/init',
  validate({
    body: z.object({
      versionId: z.number().int(),
      filename: z.string().min(1).max(255),
      contentType: z.string().min(1).max(160),
      kind: z.nativeEnum(MediaKind),
      size: z.number().int().positive(),
      contentHash: sha256.optional(),
    }),
  }),
  async (req, res) => {
    res
      .status(201)
      .json(
        await MediaUploadService.initMultipart(
          requireUser(req),
          req.body as Parameters<typeof MediaUploadService.initMultipart>[1],
        ),
      );
  },
);

// POST /api/media/multipart/:id/parts — presigned URLs for a batch of parts
router.post(
  '/multipart/:id/parts',
  validate({
    params: idParam,
    body: z.object({ partNumbers: z.array(z.number().int().min(1).max(10000)).min(1).max(64) }),
  }),
  async (req, res) => {
    res.json(
      await MediaUploadService.getPartUrls(
        requireUser(req),
        Number(req.params.id),
        (req.body as { partNumbers: number[] }).partNumbers,
      ),
    );
  },
);

// POST /api/media/multipart/:id/complete — assembles the parts (then call /finalize)
router.post(
  '/multipart/:id/complete',
  validate({
    params: idParam,
    body: z.object({
      parts: z
        .array(z.object({ partNumber: z.number().int().min(1), etag: z.string().min(1).max(200) }))
        .min(1)
        .max(10000),
    }),
  }),
  async (req, res) => {
    res.json(
      await MediaUploadService.completeMultipart(
        requireUser(req),
        Number(req.params.id),
        (req.body as { parts: { partNumber: number; etag: string }[] }).parts,
      ),
    );
  },
);

// POST /api/media/multipart/:id/abort — cancels the upload (multipart, simple PUT or sequence), frees
// what was stored and deletes the media left in UPLOADING.
router.post('/multipart/:id/abort', validate({ params: idParam }), async (req, res) => {
  res.json(await MediaUploadService.abortUpload(requireUser(req), Number(req.params.id)));
});

/* ── Image sequences: N files, ONE media (wave 5) ─────────────────────────── */

const frameName = z.string().min(1).max(FRAME_NAME_MAX_LENGTH);

// POST /api/media/sequence/init — opens (or resumes) the upload of a sequence.
router.post(
  '/sequence/init',
  validate({
    body: z.object({
      versionId: z.number().int(),
      pattern: z.string().min(1).max(255),
      frames: z
        .array(z.object({ name: frameName, size: z.number().int().nonnegative() }))
        .min(MIN_SEQUENCE_FRAMES)
        .max(MAX_SEQUENCE_FRAMES),
      framerate: z.number().positive().max(240).optional(),
    }),
  }),
  async (req, res) => {
    const body = req.body as ImageSequenceService.InitSequenceInput;
    res.status(201).json(await ImageSequenceService.initSequence(requireUser(req), body));
  },
);

// POST /api/media/sequence/:id/urls — presigned URLs for a batch of frames.
router.post(
  '/sequence/:id/urls',
  validate({
    params: idParam,
    body: z.object({ names: z.array(frameName).min(1).max(ImageSequenceService.FRAME_URL_BATCH_MAX) }),
  }),
  async (req, res) => {
    const { names } = req.body as { names: string[] };
    res.json(await ImageSequenceService.frameUploadUrls(requireUser(req), Number(req.params.id), names));
  },
);

// POST /api/media/sequence/:id/complete — checks the frames that arrived, writes the manifest and
// queues the assembly (proxy, HLS ladder, thumbnail, sprite). `note` is the upload note, refused when
// absent and the project requires it: this route finalizes the upload of a sequence, so it carries the
// same rule as /api/media/:id/finalize (Phase 50).
const sequenceCompleteBody = z.object({ note: reviewNoteSchema }).prefault({});
router.post(
  '/sequence/:id/complete',
  validate({ params: idParam, body: sequenceCompleteBody }),
  async (req, res) => {
    res.json(
      await ImageSequenceService.completeSequence(requireUser(req), Number(req.params.id), req.body.note),
    );
  },
);

// GET /api/media/sequence/:id/frames — the original deliverable, frame by frame (presigned URLs): a
// hundred-gigabyte archive is not built inside the web process.
router.get('/sequence/:id/frames', validate({ params: idParam }), async (req, res) => {
  res.json(await ImageSequenceService.listSequenceFrames(requireUser(req), Number(req.params.id)));
});

export default router;
