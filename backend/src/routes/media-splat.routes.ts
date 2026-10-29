// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as SplatEditService from '../services/SplatEditService';

/**
 * Non-destructive edits of a splat (10.G), a sub-router mounted under /api/media.
 * Writes are reserved to the media's managers, on an unpublished splat only (checked by the service; after
 * publication, an edit only travels in a comment). The original splat file is never modified.
 */
const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int() });
import { cameraAnimShape, channelSchema, curveKeySchema } from '../lib/cameraAnimSchema';

const finite = z.number().finite();
const vec3 = z.tuple([finite, finite, finite]);
const quat = z.tuple([finite, finite, finite, finite]);
const posScale = finite.positive().max(1000);
const scale3 = z.tuple([posScale, posScale, posScale]);

/**
 * PATCH /api/media/:id/splat-edits: saves (or clears, if null) the JSON edits:
 * TRS transform (gizmos) and SDF crop volumes (box or sphere, carve or isolate).
 */
router.patch(
  '/:id/splat-edits',
  validate({
    params: idParam,
    body: z.object({
      edits: z
        .object({
          transform: z.object({ position: vec3, quaternion: quat, scale: scale3 }).nullable(),
          volumes: z
            .array(
              z.object({
                shape: z.enum(['box', 'sphere']),
                mode: z.enum(['delete', 'isolate']),
                position: vec3,
                quaternion: quat,
                scale: scale3,
              }),
            )
            .max(32),
          // Orientation flip at import (11.E): true or absent means the corrected Y-down convention.
          baseFlip: z.boolean().optional(),
        })
        .nullable(),
    }),
  }),
  async (req, res) => {
    res.json(await SplatEditService.setSplatEdits(req.user!, Number(req.params.id), req.body.edits));
  },
);

/**
 * PUT /api/media/:id/splat-mask: deletion mask per splat (base64 bitset, stored in MinIO).
 * `count` = number of masked splats (display and control on the client side).
 */
router.put(
  '/:id/splat-mask',
  validate({
    params: idParam,
    body: z.object({
      data: z.string().min(1).max(5_400_000), // base64 bitset (≈ 4 MB binary max)
      count: z.number().int().positive(),
    }),
  }),
  async (req, res) => {
    res.json(
      await SplatEditService.setSplatMask(req.user!, Number(req.params.id), req.body.data, req.body.count),
    );
  },
);

/** DELETE /api/media/:id/splat-mask: clears the deletion mask. */
router.delete('/:id/splat-mask', validate({ params: idParam }), async (req, res) => {
  res.json(await SplatEditService.clearSplatMask(req.user!, Number(req.params.id)));
});

/**
 * PUT /api/media/:id/splat-subset: transformations of splat subsets (Phase 28), as binary ops (delta
 * matrix and indices) in base64 → MinIO. `count` = number of ops.
 */
router.put(
  '/:id/splat-subset',
  validate({
    params: idParam,
    body: z.object({
      data: z.string().min(1).max(5_400_000), // ops base64 (≈ 4 MB binary max)
      count: z.number().int().positive(),
    }),
  }),
  async (req, res) => {
    res.json(
      await SplatEditService.setSplatSubsetOps(
        req.user!,
        Number(req.params.id),
        req.body.data,
        req.body.count,
      ),
    );
  },
);

/** DELETE /api/media/:id/splat-subset: clears the subset transformations. */
router.delete('/:id/splat-subset', validate({ params: idParam }), async (req, res) => {
  res.json(await SplatEditService.clearSplatSubsetOps(req.user!, Number(req.params.id)));
});

const camPose = z.object({
  position: z.object({ x: finite, y: finite, z: finite }),
  target: z.object({ x: finite, y: finite, z: finite }),
  fov: finite.min(5).max(150).optional(),
  // Aspect ratio (width/height) of the fixed review frame (Phase 17): replayed letterboxed for everyone.
  aspect: finite.min(0.2).max(5).optional(),
  // Tilt (roll) of the camera around the view axis, in radians (layout mode).
  roll: finite.min(-Math.PI).max(Math.PI).optional(),
});

/**
 * PATCH /api/media/:id/splat-presentation: persisted presentation (10.G-V5): base camera, DoF, reveal,
 * default LOD, and keyframed camera animation. Manager; **allowed even on a published media** (staging
 * of the review: the media itself is not altered).
 */
router.patch(
  '/:id/splat-presentation',
  validate({
    params: idParam,
    body: z.object({
      presentation: z
        .object({
          camera: camPose.optional(),
          dof: z
            .object({ focalDistance: finite.positive().max(100000), apertureAngle: finite.min(0).max(1) })
            .optional(),
          reveal: z
            .object({
              type: z.enum(['fade', 'sweep', 'dissolve']),
              durationMs: z.number().int().min(100).max(30000),
            })
            .optional(),
          lodDefault: z.enum(['auto', 'on', 'off', 'streaming']).optional(),
          // Default lighting and HDRI of the 3D viewer (Phase 29): replayed for everyone.
          lighting: z
            .object({
              hdriId: z.string().max(300).optional(),
              exposure: finite.min(0).max(10),
              rotationDeg: finite.min(-360).max(360),
              showBackground: z.boolean(),
              // Shadow-receiving ground (39.F): optional (tolerates earlier presentations).
              groundShadow: z.boolean().optional(),
            })
            .optional(),
          // Shared camera bookmarks (39.D): named views replayed and recallable for everyone.
          bookmarks: z
            .array(z.object({ label: z.string().max(40).optional(), camera: camPose }))
            .max(12)
            .optional(),
          // "Per-channel" camera animation (Phase 17, v2): editable F-curves (position, target,
          // focal length, tilt), Hermite tangents. Replaces the v1 format (keyframes and easing).
          // Shape shared with the comment payload (`lib/cameraAnimSchema`).
          cameraAnim: z
            .object(
              cameraAnimShape(
                channelSchema(curveKeySchema({ minTime: 0, maxTime: 3_600_000 }), {
                  min: 1,
                  max: 256,
                }),
              ),
            )
            .optional(),
        })
        .nullable(),
    }),
  }),
  async (req, res) => {
    res.json(
      await SplatEditService.setSplatPresentation(req.user!, Number(req.params.id), req.body.presentation),
    );
  },
);

export default router;
