// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as ReviewReferenceService from '../services/ReviewReferenceService';

/**
 * Reference images of a 2D review, **attached to a comment** (displayed when the comment is selected,
 * position frozen at creation; no more PATCH). Added by the comment's author; reading is included in
 * getDetail.
 */
const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int() });
const refParams = z.object({ id: z.coerce.number().int(), refId: z.coerce.number().int() });

/**
 * Tolerated overflow around the media, in image widths and heights: mirror of `REF_POS_LIMIT` on the
 * client side (`pages/review/referenceBox.ts`).
 */
const POS_LIMIT = 3;

/**
 * Position and size as fractions of the image. A reference can be placed **anywhere** on the viewer's
 * canvas, inside as well as outside the frame of the media: the 0..1 bounding pinned it on the image by
 * default, and the letterbox bands still forbade the sides of a wide shot. The schema therefore refuses
 * only the unrecoverable: beyond three image widths or heights of overflow no viewer shows it any more,
 * and a `NaN` or `Infinity` would make a `left: NaN%` that does not display (`1e999` goes through JSON as
 * `Infinity`). Inherited positions may exceed this frame: the display catches those no viewer would show.
 */
const fraction = z.number().finite();
const referenceBody = z.object({
  dataUrl: z.string().min(1).max(8_400_000),
  commentId: z.number().int(),
  x: fraction.min(-POS_LIMIT).max(POS_LIMIT).optional(),
  y: fraction.min(-POS_LIMIT).max(POS_LIMIT).optional(),
  width: fraction.min(0.02).max(1).optional(),
});

// POST /api/media/:id/references — attaches an image (base64 data URL) to a comment
router.post('/:id/references', validate({ params: idParam, body: referenceBody }), async (req, res) => {
  const { dataUrl, commentId, ...pos } = req.body;
  res.status(201).json({
    reference: await ReviewReferenceService.add(req.user!, Number(req.params.id), dataUrl, commentId, pos),
  });
});

// DELETE /api/media/:id/references/:refId — removes a reference image
router.delete('/:id/references/:refId', validate({ params: refParams }), async (req, res) => {
  await ReviewReferenceService.remove(req.user!, Number(req.params.id), Number(req.params.refId));
  res.status(204).end();
});

export default router;
