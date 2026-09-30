// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { assertProjectAccess, requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import * as PlaylistService from '../services/PlaylistService';
import * as PlaylistCandidateService from '../services/PlaylistCandidateService';

const router = Router();
router.use(authenticate);

const idsSchema = z.array(z.number().int().positive()).max(200);
const canWrite = requireRole(Role.ADMIN, Role.SUPERVISOR, Role.ARTIST);

// GET /api/playlists?projectId= — playlists du projet (Phase 33)
router.get(
  '/',
  validate({ query: z.object({ projectId: z.coerce.number().int().positive() }) }),
  async (req, res) => {
    const projectId = Number(req.query.projectId);
    await assertProjectAccess(req, projectId);
    res.json({ playlists: await PlaylistService.listForProject(projectId) });
  },
);

/**
 * GET /api/playlists/candidates?projectId= — catalogue des versions à mettre en playlist.
 *
 * Déclarée avant `/:id` pour que « candidates » ne soit pas lu comme un identifiant.
 */
router.get(
  '/candidates',
  validate({
    query: z.object({
      projectId: z.coerce.number().int().positive(),
      q: z.string().trim().max(120).optional(),
      sequenceId: z.union([z.coerce.number().int().positive(), z.literal('none')]).optional(),
      department: z.string().trim().max(40).optional(),
      latestOnly: z.coerce.boolean().optional(),
      limit: z.coerce.number().int().min(1).max(300).optional(),
    }),
  }),
  async (req, res) => {
    const projectId = Number(req.query.projectId);
    await assertProjectAccess(req, projectId);
    const query = req.query as unknown as PlaylistCandidateService.CandidateQuery;
    res.json({ candidates: await PlaylistCandidateService.list(projectId, req.user!.id, query) });
  },
);

// POST /api/playlists — créer (items initiaux depuis versions et/ou médias sélectionnés)
router.post(
  '/',
  canWrite,
  validate({
    body: z.object({
      projectId: z.number().int().positive(),
      name: z.string().trim().min(1).max(120),
      versionIds: idsSchema.optional(),
      mediaIds: idsSchema.optional(),
    }),
  }),
  async (req, res) => {
    const { projectId, name, versionIds, mediaIds } = req.body as {
      projectId: number;
      name: string;
      versionIds?: number[];
      mediaIds?: number[];
    };
    await assertProjectAccess(req, projectId);
    const playlist = await PlaylistService.create(req.user!, projectId, name, versionIds, mediaIds);
    res.status(201).json({ playlist });
  },
);

// GET /api/playlists/:id — détail (items ordonnés + premier média visible par version)
router.get(
  '/:id',
  validate({ params: z.object({ id: z.coerce.number().int().positive() }) }),
  async (req, res) => {
    const id = Number(req.params.id);
    const owning = await PlaylistService.getOwning(id);
    await assertProjectAccess(req, owning.projectId);
    res.json({ playlist: await PlaylistService.getDetail(req.user!, id) });
  },
);

// PATCH /api/playlists/:id — renommer et/ou réordonner (itemIds = nouvel ordre complet)
router.patch(
  '/:id',
  canWrite,
  validate({
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: z.object({
      name: z.string().trim().min(1).max(120).optional(),
      itemIds: z.array(z.number().int().positive()).max(500).optional(),
    }),
  }),
  async (req, res) => {
    const id = Number(req.params.id);
    const owning = await PlaylistService.getOwning(id);
    await assertProjectAccess(req, owning.projectId);
    const { name, itemIds } = req.body as { name?: string; itemIds?: number[] };
    if (name !== undefined) await PlaylistService.rename(req.user!, id, name);
    if (itemIds !== undefined) await PlaylistService.reorder(req.user!, id, itemIds);
    res.json({ playlist: await PlaylistService.getDetail(req.user!, id) });
  },
);

// POST /api/playlists/:id/items — ajouter des versions/médias en fin (dédupliqué)
router.post(
  '/:id/items',
  canWrite,
  validate({
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: z
      .object({ versionIds: idsSchema.optional(), mediaIds: idsSchema.optional() })
      .refine((b) => (b.versionIds?.length ?? 0) + (b.mediaIds?.length ?? 0) > 0, {
        message: 'versionIds ou mediaIds requis',
      }),
  }),
  async (req, res) => {
    const id = Number(req.params.id);
    const owning = await PlaylistService.getOwning(id);
    await assertProjectAccess(req, owning.projectId);
    const { versionIds, mediaIds } = req.body as { versionIds?: number[]; mediaIds?: number[] };
    res.json(await PlaylistService.addItems(req.user!, id, versionIds, mediaIds));
  },
);

// DELETE /api/playlists/:id/items/:itemId — retirer un item
router.delete(
  '/:id/items/:itemId',
  canWrite,
  validate({
    params: z.object({
      id: z.coerce.number().int().positive(),
      itemId: z.coerce.number().int().positive(),
    }),
  }),
  async (req, res) => {
    const id = Number(req.params.id);
    const owning = await PlaylistService.getOwning(id);
    await assertProjectAccess(req, owning.projectId);
    await PlaylistService.removeItem(req.user!, id, Number(req.params.itemId));
    res.status(204).end();
  },
);

// DELETE /api/playlists/:id — supprimer la playlist (références seulement, pas de contenu)
router.delete(
  '/:id',
  canWrite,
  validate({ params: z.object({ id: z.coerce.number().int().positive() }) }),
  async (req, res) => {
    const id = Number(req.params.id);
    const owning = await PlaylistService.getOwning(id);
    await assertProjectAccess(req, owning.projectId);
    await PlaylistService.remove(req.user!, id);
    res.status(204).end();
  },
);

export default router;
