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
 * Une frappe dans la palette déclenche dix requêtes dont une recherche plein texte. Le
 * front débounce à 200 ms et n'interroge qu'à partir de deux caractères ; le limiteur borne
 * ce que le serveur accepte de toute façon, quel que soit le client en face.
 */
const searchLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  keyGenerator: identityRateKey,
  name: 'search',
});

// GET /api/search?q=… — recherche globale (entités du pipe, versions, médias, playlists,
// notes de review en plein texte, personnes). RBAC porté par `searchEntities`.
router.get(
  '/',
  searchLimiter,
  // Un seul caractère ne discrimine rien et fait balayer toutes les tables : la palette
  // attend le second.
  validate({ query: z.object({ q: z.string().trim().min(2).max(100) }) }),
  async (req, res) => {
    // `req.query` d'Express 5 est un accesseur : le `.trim()` de Zod valide la saisie mais
    // ne la réécrit pas. Sans ce trim-ci, « ␣␣v012 » cherchait `ILIKE '%  v012%'`, qui ne
    // rend jamais rien.
    const q = String(req.query.q).trim();
    const { id, role } = req.user!;
    res.json(await searchEntities(q, id, role));
  },
);

export default router;
