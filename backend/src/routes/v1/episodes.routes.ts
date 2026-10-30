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
 * The episode level, integration side.
 *
 * It arrived with series support (one level above sequences) but never reached `/api/v1`:
 * a third-party sync saw orphan sequences and had no way to know which episode they belonged
 * to, or even that the project had episodes.
 *
 * Read-only, on purpose. Splitting a series into episodes is a production action that reorders,
 * attaches and renames; exposing it for writing would mean reproducing everything the episodes
 * screen orchestrates, for a need no integration has expressed. `episodesEnabled` also says
 * whether the level exists on this project.
 */
const router = Router();

/**
 * GET /api/v1/projects/{ref}/episodes: the project's episodes.
 *
 * `enabled` is false on a feature film: the list is then empty, and that is an answer, not an
 * absence. `unassignedSequences` counts the sequences no episode claims. A split in progress
 * always leaves some, and hiding them would make the project look empty.
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

// GET /api/v1/episodes/{id}: the record, with its sequences and their shots.
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
 * GET /api/v1/episodes/{id}/sequences: the attached sequences, v1 shape.
 *
 * The record above returns the full tree (sequences AND shots); this one returns the same
 * collection in the shape the other v1 routes use, so a client can continue on
 * `/api/v1/sequences/{id}/...` without translating two representations.
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
