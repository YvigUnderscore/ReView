// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, RequestHandler } from 'express';
import { rateLimit } from '../middleware/rateLimit';

/**
 * Rate brakes of the PUBLIC sharing surface (A2-02).
 *
 * `POST /api/client/:token/media/:id/comments` writes to the database on presentation of a link, with no
 * account behind it: neither `authenticate` nor the per-identity ceiling of the global limiter, which falls
 * back to the IP here. It was therefore the only write of the application open to an anonymous visitor
 * and left unbraked: each call creates a `Comment` row, triggers a socket broadcast, an outgoing webhook,
 * a v1 journal entry and a ShotGrid note.
 *
 * Two counters, because neither one suffices alone:
 *
 *  - **per link**: under `TRUST_PROXY`, `req.ip` is what the `X-Forwarded-For` header declares, hence a
 *    value the caller chooses. A key containing the IP can be renewed at will and then bounds nothing.
 *    The share token, for its part, is in the URL and cannot be changed without losing access: it is the
 *    only unforgeable discriminant of this surface, and therefore the only ceiling that truly holds.
 *  - **per link and per IP**, tighter: it prevents a chatty client, or a loop in its browser, from
 *    swallowing the link's whole budget on its own to the detriment of the other guests. It does not
 *    claim to resist a forged IP; the first counter takes care of that.
 *
 * The limiter fails closed (cf. `middleware/rateLimit`): silent Redis means 429.
 */

const WINDOW_MS = 15 * 60 * 1000;
/** Budget of a share link, all guests combined. */
const PER_LINK_MAX = 120;
/** Budget of one guest, identified by their IP on this link: a subset of the previous one. */
const PER_LINK_AND_IP_MAX = 30;

const TOO_MANY = { error: 'Too many comments, try again later.' };

/** The token as it arrives: the brake runs BEFORE the Zod validation of the path. */
const shareToken = (req: Request): string => String(req.params.token ?? '');

export const guestCommentRateLimit: RequestHandler[] = [
  rateLimit({
    windowMs: WINDOW_MS,
    max: PER_LINK_MAX,
    message: TOO_MANY,
    name: 'guest-comment-link',
    keyGenerator: (req) => `share:${shareToken(req)}`,
  }),
  rateLimit({
    windowMs: WINDOW_MS,
    max: PER_LINK_AND_IP_MAX,
    message: TOO_MANY,
    name: 'guest-comment-ip',
    keyGenerator: (req) => `share:${shareToken(req)}:${req.ip ?? 'unknown'}`,
  }),
];
