// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { MediaKind } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as MediaUploadService from '../services/MediaUploadService';
import * as MediaService from '../services/MediaService';
import * as ImageSequenceService from '../services/ImageSequenceService';
import { FRAME_NAME_MAX_LENGTH, MAX_SEQUENCE_FRAMES, MIN_SEQUENCE_FRAMES } from '../lib/imageSequence';

/**
 * Upload résumable multipart (37.A/37.B) et envoi de séquences d'images (vague 5) —
 * monté sous /api/media AVANT media.routes (sinon `/multipart/...` et `/sequence/...`
 * matcheraient `/:id`). L'upload simple (PUT présigné) reste dans media.routes pour les
 * petits fichiers.
 */
const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int() });
const sha256 = z
  .string()
  .regex(/^[0-9a-f]{64}$/i)
  .transform((s) => s.toLowerCase());

/**
 * POST /api/media/upload-url — upload simple (PUT présigné) pour les petits fichiers :
 * crée un MediaObject (UPLOADING) + URL présignée, sans toucher le FS serveur.
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
      contentHash: sha256.optional(), // sha256 client (37.B) — vérifié par le worker
    }),
  }),
  async (req, res) => {
    res.status(201).json(await MediaService.createUpload(req.user!, req.body));
  },
);

// POST /api/media/multipart/init — crée (ou retrouve) l'upload ; dédup par hash
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
          req.user!,
          req.body as Parameters<typeof MediaUploadService.initMultipart>[1],
        ),
      );
  },
);

// POST /api/media/multipart/:id/parts — URLs présignées d'un lot de parts
router.post(
  '/multipart/:id/parts',
  validate({
    params: idParam,
    body: z.object({ partNumbers: z.array(z.number().int().min(1).max(10000)).min(1).max(64) }),
  }),
  async (req, res) => {
    res.json(
      await MediaUploadService.getPartUrls(
        req.user!,
        Number(req.params.id),
        (req.body as { partNumbers: number[] }).partNumbers,
      ),
    );
  },
);

// POST /api/media/multipart/:id/complete — assemble les parts (puis appeler /finalize)
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
        req.user!,
        Number(req.params.id),
        (req.body as { parts: { partNumber: number; etag: string }[] }).parts,
      ),
    );
  },
);

// POST /api/media/multipart/:id/abort — annule l'upload (multipart, PUT simple ou
// séquence), libère ce qui a été déposé et supprime le média resté en UPLOADING.
router.post('/multipart/:id/abort', validate({ params: idParam }), async (req, res) => {
  res.json(await MediaUploadService.abortUpload(req.user!, Number(req.params.id)));
});

/* ── Séquences d'images : N fichiers, UN média (vague 5) ─────────────────────────── */

const frameName = z.string().min(1).max(FRAME_NAME_MAX_LENGTH);

// POST /api/media/sequence/init — ouvre (ou reprend) l'envoi d'une séquence.
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
    res.status(201).json(await ImageSequenceService.initSequence(req.user!, body));
  },
);

// POST /api/media/sequence/:id/urls — URLs présignées d'un lot de frames.
router.post(
  '/sequence/:id/urls',
  validate({
    params: idParam,
    body: z.object({ names: z.array(frameName).min(1).max(ImageSequenceService.FRAME_URL_BATCH_MAX) }),
  }),
  async (req, res) => {
    const { names } = req.body as { names: string[] };
    res.json(await ImageSequenceService.frameUploadUrls(req.user!, Number(req.params.id), names));
  },
);

// POST /api/media/sequence/:id/complete — vérifie les frames arrivées, écrit le manifeste
// et enfile l'assemblage (proxy + échelle HLS + miniature + sprite).
router.post('/sequence/:id/complete', validate({ params: idParam }), async (req, res) => {
  res.json(await ImageSequenceService.completeSequence(req.user!, Number(req.params.id)));
});

// GET /api/media/sequence/:id/frames — le livrable d'origine, frame par frame (URLs
// présignées) : une archive de cent gigaoctets ne se fabrique pas dans le processus web.
router.get('/sequence/:id/frames', validate({ params: idParam }), async (req, res) => {
  res.json(await ImageSequenceService.listSequenceFrames(req.user!, Number(req.params.id)));
});

export default router;
