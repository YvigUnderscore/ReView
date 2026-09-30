// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { prisma } from '../lib/prisma';
import { badRequest, notFound } from '../lib/errors';
import { assertProjectManager } from '../lib/shotgridAccess';
import * as Config from '../services/shotgrid/ShotgridConfigService';
import { runSync } from '../services/shotgrid/ShotgridSyncService';
import { createTaskFromStep, listProjectMembers, listSteps } from '../services/shotgrid/ShotgridSteps';

/**
 * Réalignement d'une entité seule sur ShotGrid.
 *
 * La comparaison du projet dit ce qui diverge, mais tout réaligner d'un geste est une
 * décision lourde qu'on ne prend pas pour un plan. Ici on relit une entité précise :
 * ShotGrid fait foi, la valeur locale est réécrite depuis le site, et rien d'autre n'est
 * touché. C'est l'action qu'appelle la pastille posée sur un plan, un asset ou une tâche.
 */
const router = Router();
router.use(authenticate);

const LOCAL_TYPES = ['sequence', 'shot', 'asset', 'task', 'version'] as const;

router.post(
  '/projects/:projectId/realign',
  validate({
    params: z.object({ projectId: z.coerce.number().int().positive() }),
    body: z.object({
      localType: z.enum(LOCAL_TYPES),
      localId: z.number().int().positive(),
    }),
  }),
  async (req, res) => {
    const projectId = Number(req.params.projectId);
    await assertProjectManager(req.user!, projectId);
    const connection = await Config.getConnection(projectId);
    if (!connection?.active) throw badRequest('Project not linked to ShotGrid');

    const link = await prisma.shotgridLink.findFirst({
      where: {
        connectionId: connection.id,
        localType: req.body.localType,
        localId: req.body.localId,
      },
      select: { sgType: true, sgId: true },
    });
    // Une entité sans lien n'existe pas là-bas : la « réaligner » reviendrait à la créer,
    // ce que le studio a précisément choisi de faire depuis ShotGrid. On le dit plutôt
    // que d'inventer une entité distante.
    if (!link) throw notFound('This entity has no ShotGrid counterpart');

    const result = await runSync(projectId, {
      kind: 'incremental',
      onlySgIds: [{ sgType: link.sgType, sgId: link.sgId }],
      withMedia: req.body.localType === 'version',
      triggeredById: req.user!.id,
    });
    res.json({ status: result.status, sgType: link.sgType, sgId: link.sgId });
  },
);

/**
 * Étapes de pipeline du site, pour créer la tâche qui manque.
 *
 * Les colonnes qu'on voit dans ShotGrid — art, model, rig, groom, lookdev — sont des
 * étapes, pas des tâches : un asset neuf les porte toutes, vides. Les proposer ici évite
 * l'aller-retour « créer la tâche dans ShotGrid, revenir, resynchroniser ».
 */
router.get(
  '/projects/:projectId/steps',
  validate({
    params: z.object({ projectId: z.coerce.number().int().positive() }),
    query: z.object({
      entityType: z.enum(['Asset', 'Shot']),
      // Par défaut on s'en tient aux étapes que le projet emploie ; le catalogue complet
      // du site reste accessible à qui le demande explicitement.
      all: z.coerce.boolean().optional(),
    }),
  }),
  async (req, res) => {
    const projectId = Number(req.params.projectId);
    await assertProjectManager(req.user!, projectId, { allowMembers: true });
    const connection = await Config.getConnection(projectId);
    if (!connection?.active) return res.json({ steps: [] });
    res.json({
      steps: await listSteps(projectId, req.query.entityType as 'Asset' | 'Shot', {
        // Express 5 ne remplace pas `req.query` par la valeur validée : la valeur y reste
        // une chaîne, quel que soit le schéma Zod.
        all: String(req.query.all) === 'true',
      }),
    });
  },
);

router.post(
  '/projects/:projectId/tasks',
  validate({
    params: z.object({ projectId: z.coerce.number().int().positive() }),
    body: z.object({
      stepSgId: z.number().int().positive(),
      parentType: z.enum(['asset', 'shot']),
      parentId: z.number().int().positive(),
      name: z.string().min(1).max(160).optional(),
      assigneeSgId: z.number().int().positive().nullish(),
    }),
  }),
  async (req, res) => {
    const projectId = Number(req.params.projectId);
    await assertProjectManager(req.user!, projectId);
    res.status(201).json(await createTaskFromStep(projectId, req.body, req.user!.email ?? null));
  },
);

/** Personnes affectées au projet sur le site — celles à qui une tâche peut être confiée. */
router.get(
  '/projects/:projectId/members',
  validate({ params: z.object({ projectId: z.coerce.number().int().positive() }) }),
  async (req, res) => {
    const projectId = Number(req.params.projectId);
    await assertProjectManager(req.user!, projectId, { allowMembers: true });
    const connection = await Config.getConnection(projectId);
    if (!connection?.active) return res.json({ members: [] });
    res.json({ members: await listProjectMembers(projectId) });
  },
);

export default router;
