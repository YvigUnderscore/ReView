// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { MediaKind } from '@prisma/client';
import { validate } from '../../middleware/validate';
import { requireScope, assertTokenProject } from '../../middleware/scope';
import { assertProjectAccess } from '../../middleware/rbac';
import { idempotency } from '../../lib/idempotency';
import { usdRequestSchema } from '../../lib/usdRequest';
import { reviewNoteSchema } from '../../lib/projectSettings';
import { reviewersSchema } from '../../services/ReviewAssignmentService';
import * as PublishFlowService from '../../services/PublishFlowService';
import * as Resolve from '../../services/PipelineResolveService';
import { parsePipelinePath } from '../../lib/pipelinePath';
import { idParam, requireMediaProject } from './helpers';
import { requireUser } from '../../middleware/auth';

/**
 * Publishing from a DCC (API v1): two calls, described in `PublishFlowService`.
 *
 * Idempotency is wired here: this is the write most costly to replay blindly (a duplicate version
 * in a review), and the one most often sent from a workstation whose connection to the studio is
 * not guaranteed.
 *
 * Both calls require `versions:write` **and** `media:write`: publishing creates a version, but it
 * also opens a storage upload and then attaches a media to it. A token carrying only the first
 * would otherwise write into the second without having asked for it.
 */
const router = Router();

const sha256 = z
  .string()
  .regex(/^[0-9a-f]{64}$/i)
  .transform((s) => s.toLowerCase());

// POST /api/v1/publish: opens the publication and returns the upload URL
router.post(
  '/',
  requireScope('versions:write', 'media:write'),
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
      // USD scene: the selection is known to the DCC at publish time. Giving it here avoids a full
      // Blender conversion being redone for nothing via `usd/recompose`.
      usd: usdRequestSchema
        .optional()
        .describe(
          'Scène USD (médias 3D) : variantes et purpose appliqués dès la première conversion. ' +
            'Fournir la sélection ici évite un POST /api/media/{id}/usd/recompose et la ' +
            'conversion complète qu’il referait.',
        ),
    }),
  }),
  async (req, res) => {
    const body = req.body as PublishFlowService.StartPublishInput;
    // Access is checked BEFORE anything is created: the path is resolved once for its project only,
    // with no side effects.
    const project = await Resolve.resolveProject(parsePipelinePath(body.path).project);
    await assertProjectAccess(req, project.id);
    assertTokenProject(req, project.id);

    res.status(201).json(await PublishFlowService.start(requireUser(req), body));
  },
);

// POST /api/v1/publish/:id/complete: finalizes the upload and publishes
router.post(
  '/:id/complete',
  requireScope('versions:write', 'media:write'),
  idempotency,
  validate({
    params: idParam,
    body: z.object({
      publish: z.boolean().optional(),
      submitForReview: z.boolean().optional(),
      note: reviewNoteSchema.describe(
        'Consigne accompagnant la livraison. Le projet peut l’exiger et lui imposer une ' +
          'longueur minimale (section « reviewRequest ») : la finalisation est alors refusée ' +
          'sans elle, codes UPLOAD_NOTE_REQUIRED / UPLOAD_NOTE_TOO_SHORT.',
      ),
      reviewers: reviewersSchema
        .optional()
        .describe(
          'À qui confier la review de cette version, et ce que chacun doit y regarder. Le ' +
            'projet peut exiger la consigne et lui imposer une longueur minimale : la ' +
            'publication est alors refusée sans elle. Voir GET /api/v1/projects/{ref}/settings, ' +
            'section « reviewRequest ».',
        ),
    }),
  }),
  async (req, res) => {
    const mediaId = Number(req.params.id);
    await requireMediaProject(req, mediaId);
    const body = req.body as PublishFlowService.CompletePublishInput;
    res.json(await PublishFlowService.complete(requireUser(req), mediaId, body));
  },
);

export default router;
