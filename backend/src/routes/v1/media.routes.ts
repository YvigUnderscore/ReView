// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { requireScope } from '../../middleware/scope';
import { toMedia } from '../../lib/v1Resources';
import { idParam, readQuery } from './helpers';
import { loadReadableMedia, signVariant, urlQuery } from './mediaAccess';

/**
 * Media in API v1: a file's record, and the URL to read it.
 *
 * This is the counterpart of `/api/v1/publish`: a workstation pushes a render, then fetches the
 * reference it needs (an approved plate, a layout to load). Without these two routes, a DCC
 * integration could only push.
 */
const router = Router();

// GET /api/v1/media/:id: media record (no URL here: it is requested separately, and it expires)
router.get('/media/:id', requireScope('media:read'), validate({ params: idParam }), async (req, res) => {
  const media = await loadReadableMedia(req, Number(req.params.id));
  res.json({ media: toMedia(media), versionId: media.versionId });
});

/**
 * GET /api/v1/media/:id/url: presigned read URL.
 *
 * `variant` picks what is fetched: `source` (the deposited file, or the proxy when the original was
 * deleted after transcoding), `proxy` (the review MP4, cut included) or `thumbnail`. `expiresIn`
 * bounds validity: a farm distributing the URL to its nodes wants it short, an artist downloading a
 * 40 GB shot wants it long.
 */
router.get(
  '/media/:id/url',
  requireScope('media:read'),
  validate({ params: idParam, query: urlQuery }),
  async (req, res) => {
    // Express 5: `req.query` is a getter, the middleware's coercion does not persist.
    const { variant, expiresIn } = readQuery(urlQuery, req);
    const media = await loadReadableMedia(req, Number(req.params.id));
    const url = await signVariant(media, variant, expiresIn);
    res.json({ mediaId: media.id, variant, expiresIn, url, media: toMedia(media) });
  },
);

export default router;
