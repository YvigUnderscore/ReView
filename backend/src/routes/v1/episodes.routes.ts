// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { validate } from '../../middleware/validate';
import { requireScope } from '../../middleware/scope';
import { notFound } from '../../lib/errors';
import { readPagination } from '../../lib/pagination';
import { sequenceSelect, toSequence } from '../../lib/v1Resources';
import * as EpisodeService from '../../services/EpisodeService';
import { idParam, listQuery, refParam, requireEpisodeProject, requireProject } from './helpers';

/**
 * Le niveau épisode, côté intégrations.
 *
 * Il est arrivé avec la série (un cran au-dessus de la séquence) sans jamais atteindre
 * `/api/v1` : une synchronisation tierce voyait des séquences orphelines et n'avait aucun
 * moyen de savoir de quel épisode elles relevaient — ni même que le projet en avait.
 *
 * Lecture seule, volontairement. Découper une série en épisodes est un geste de production
 * qui réordonne, rattache et renomme ; l'exposer en écriture demanderait de reproduire
 * tout ce que l'écran d'épisodes orchestre, pour un besoin qu'aucune intégration n'a
 * formulé. `episodesEnabled` dit d'ailleurs si le niveau existe seulement sur ce projet.
 */
const router = Router();

/**
 * GET /api/v1/projects/{ref}/episodes — les épisodes du projet.
 *
 * `enabled` vaut faux sur un long-métrage : la liste est alors vide, et c'est une réponse,
 * pas une absence. `unassignedSequences` compte les séquences qu'aucun épisode ne réclame
 * — un découpage en cours en laisse toujours, et les taire ferait croire le projet vide.
 */
router.get(
  '/projects/:ref/episodes',
  requireScope('episodes:read'),
  validate({ params: refParam, query: listQuery }),
  async (req, res) => {
    const project = await requireProject(req, String(req.params.ref));
    const enabled = await EpisodeService.isEnabled(project.id);
    if (!enabled) {
      res.json({ enabled, episodes: [], unassignedSequences: 0, total: 0, page: 1, pageSize: 0 });
      return;
    }
    const page = await EpisodeService.list(project.id, readPagination(req.query));
    res.json({ enabled, ...page });
  },
);

// GET /api/v1/episodes/{id} — la fiche, avec ses séquences et leurs plans.
router.get(
  '/episodes/:id',
  requireScope('episodes:read'),
  validate({ params: idParam }),
  async (req, res) => {
    const id = Number(req.params.id);
    await requireEpisodeProject(req, id);
    const episode = await EpisodeService.getDetail(id);
    if (!episode) throw notFound('Episode not found');
    res.json({ episode });
  },
);

/**
 * GET /api/v1/episodes/{id}/sequences — les séquences rattachées, forme v1.
 *
 * La fiche ci-dessus rend l'arbre complet (séquences ET plans) ; celle-ci rend la même
 * collection sous la forme que les autres routes v1 emploient, pour qu'un client puisse
 * enchaîner sur `/api/v1/sequences/{id}/…` sans transposer deux représentations.
 */
router.get(
  '/episodes/:id/sequences',
  requireScope('sequences:read'),
  validate({ params: idParam }),
  async (req, res) => {
    const id = Number(req.params.id);
    await requireEpisodeProject(req, id);
    const rows = await prisma.sequence.findMany({
      where: { episodeId: id, deletedAt: null },
      orderBy: [{ order: 'asc' }, { code: 'asc' }],
      select: sequenceSelect,
    });
    res.json({ sequences: rows.map(toSequence) });
  },
);

export default router;
