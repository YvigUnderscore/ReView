// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { requireScope } from '../../middleware/scope';
import { toMedia } from '../../lib/v1Resources';
import { idParam, readQuery } from './helpers';
import { loadReadableMedia, signVariant, urlQuery } from './mediaAccess';

/**
 * Médias de l'API v1 : la fiche d'un fichier, et l'URL pour le lire.
 *
 * C'est le pendant de `/api/v1/publish` : un poste d'artiste pousse un rendu, puis vient
 * chercher la référence dont il a besoin (une plate approuvée, un layout à charger). Sans
 * ces deux routes, une intégration DCC ne pouvait que pousser.
 */
const router = Router();

// GET /api/v1/media/:id — fiche du média (sans URL : elle se demande, et elle expire)
router.get('/media/:id', requireScope('media:read'), validate({ params: idParam }), async (req, res) => {
  const media = await loadReadableMedia(req, Number(req.params.id));
  res.json({ media: toMedia(media), versionId: media.versionId });
});

/**
 * GET /api/v1/media/:id/url — URL présignée de lecture.
 *
 * `variant` choisit ce qu'on rapatrie : `source` (le fichier déposé, ou le proxy quand
 * l'original a été effacé après transcodage), `proxy` (le MP4 de review, coupe comprise)
 * ou `thumbnail`. `expiresIn` borne la validité : une ferme qui distribue l'URL à ses
 * nœuds la veut courte, un artiste qui télécharge un plan de 40 Go la veut longue.
 */
router.get(
  '/media/:id/url',
  requireScope('media:read'),
  validate({ params: idParam, query: urlQuery }),
  async (req, res) => {
    // Express 5 : `req.query` est un getter, la coercition du middleware ne persiste pas.
    const { variant, expiresIn } = readQuery(urlQuery, req);
    const media = await loadReadableMedia(req, Number(req.params.id));
    const url = await signVariant(media, variant, expiresIn);
    res.json({ mediaId: media.id, variant, expiresIn, url, media: toMedia(media) });
  },
);

export default router;
