// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { MediaKind } from '@prisma/client';
import { validate } from '../../middleware/validate';
import { requireScope, assertTokenProject } from '../../middleware/scope';
import { assertProjectAccess } from '../../middleware/rbac';
import { idempotency } from '../../lib/idempotency';
import * as PublishFlowService from '../../services/PublishFlowService';
import * as Resolve from '../../services/PipelineResolveService';
import { parsePipelinePath } from '../../lib/pipelinePath';
import { idParam, requireMediaProject } from './helpers';

/**
 * Publication depuis un DCC (API v1) — deux appels, décrits dans `PublishFlowService`.
 *
 * L'idempotence est branchée ici : c'est l'écriture la plus coûteuse à rejouer à
 * l'aveugle (une version en double dans une review), et celle qui part le plus souvent
 * d'un poste dont la connexion au studio n'est pas garantie.
 */
const router = Router();

const sha256 = z
  .string()
  .regex(/^[0-9a-f]{64}$/i)
  .transform((s) => s.toLowerCase());

// POST /api/v1/publish — ouvre la publication et renvoie l'URL d'envoi
router.post(
  '/',
  requireScope('versions:write'),
  idempotency,
  validate({
    body: z.object({
      path: z.string().min(1).max(1200),
      filename: z.string().min(1).max(255),
      contentType: z.string().min(1).max(160).optional(),
      kind: z.nativeEnum(MediaKind).optional(),
      size: z.number().int().nonnegative().optional(),
      contentHash: sha256.optional(),
      versionName: z.string().trim().min(1).max(60).optional(),
      reuseVersion: z.boolean().optional(),
      createMissing: z.boolean().default(true),
      shot: z
        .object({
          name: z.string().trim().min(1).max(160).optional(),
          startFrame: z.number().int().optional(),
          endFrame: z.number().int().optional(),
        })
        .optional(),
    }),
  }),
  async (req, res) => {
    const body = req.body as PublishFlowService.StartPublishInput;
    // L'accès est vérifié AVANT que quoi que ce soit ne soit créé : le chemin est résolu
    // une première fois pour son seul projet, sans effet de bord.
    const project = await Resolve.resolveProject(parsePipelinePath(body.path).project);
    await assertProjectAccess(req, project.id);
    assertTokenProject(req, project.id);

    res.status(201).json(await PublishFlowService.start(req.user!, body));
  },
);

// POST /api/v1/publish/:id/complete — finalise l'envoi et publie
router.post(
  '/:id/complete',
  requireScope('versions:write'),
  idempotency,
  validate({
    params: idParam,
    body: z.object({
      publish: z.boolean().optional(),
      submitForReview: z.boolean().optional(),
    }),
  }),
  async (req, res) => {
    const mediaId = Number(req.params.id);
    await requireMediaProject(req, mediaId);
    const body = req.body as PublishFlowService.CompletePublishInput;
    res.json(await PublishFlowService.complete(req.user!, mediaId, body));
  },
);

export default router;
