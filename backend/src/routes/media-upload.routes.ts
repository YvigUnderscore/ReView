// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { MediaKind } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as MediaUploadService from '../services/MediaUploadService';
import * as MediaService from '../services/MediaService';

/**
 * Upload résumable multipart (37.A/37.B) — monté sous /api/media AVANT media.routes
 * (sinon `/multipart/...` matcherait `/:id`). L'upload simple (PUT présigné) reste
 * dans media.routes pour les petits fichiers.
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

// POST /api/media/multipart/:id/abort — annule l'upload (multipart ou PUT simple),
// libère les parts déjà déposées et supprime le média resté en UPLOADING.
router.post('/multipart/:id/abort', validate({ params: idParam }), async (req, res) => {
  res.json(await MediaUploadService.abortUpload(req.user!, Number(req.params.id)));
});

export default router;
