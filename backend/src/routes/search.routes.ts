// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { rateLimit, identityRateKey } from '../middleware/rateLimit';
import { searchEntities } from '../lib/search';

const router = Router();
router.use(authenticate);

/**
 * A keystroke in the palette triggers ten requests, one of which is a full-text search. The front end
 * debounces at 200 ms and only queries from two characters on; the limiter bounds what the server
 * accepts in any case, whatever client is on the other end.
 */
const searchLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  keyGenerator: identityRateKey,
  name: 'search',
});

// GET /api/search?q=… — global search (pipe entities, versions, media, playlists, full-text review
// notes, people). RBAC carried by `searchEntities`.
router.get(
  '/',
  searchLimiter,
  // A single character discriminates nothing and sweeps every table: the palette waits for the second.
  validate({ query: z.object({ q: z.string().trim().min(2).max(100) }) }),
  async (req, res) => {
    // Express 5's `req.query` is an accessor: Zod's `.trim()` validates the input but does not rewrite it.
    // Without this trim, a query of two spaces plus "v012" searched `ILIKE '%  v012%'`, which never
    // returns anything.
    const q = String(req.query.q).trim();
    const { id, role } = req.user!;
    res.json(await searchEntities(q, id, role));
  },
);

export default router;
