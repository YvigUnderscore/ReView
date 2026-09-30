// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { VisitTargetType } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { assertProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import {
  resolveProjectIdForAsset,
  resolveProjectIdForMedia,
  resolveProjectIdForProject,
  resolveProjectIdForSequence,
  resolveProjectIdForShot,
  resolveProjectIdForTask,
} from '../lib/pipeline';
import { notFound } from '../lib/errors';
import * as EntityVisitService from '../services/EntityVisitService';

/**
 * Acquittement de visite (Phase 50, lot 9) : « je l'ai ouvert, éteins la lueur ».
 *
 * La visite est une donnée strictement personnelle — elle ne dit rien de l'entité, tout de
 * son lecteur. L'autorisation n'en est pas moins vérifiée : marquer visité ce qu'on n'a pas
 * le droit de lire n'aurait aucun sens, et la réponse confirmerait au passage l'existence
 * de l'entité.
 *
 * Ce routeur est monté sur `/api/visits` — pas sur `/api` : `router.use(authenticate)` y
 * est donc sans danger.
 */

const router = Router();
router.use(authenticate);

/**
 * Types qu'on sait autoriser : ceux dont le projet propriétaire se résout.
 *
 * L'énumération Prisma en compte huit (la forme du mécanisme est connue), la route n'en
 * accepte que six : playlist et board n'ont pas de résolveur de projet. Mieux vaut un 400
 * franc qu'un acquittement écrit sans contrôle d'accès.
 */
const PROJECT_OF: Partial<Record<VisitTargetType, (id: number) => Promise<number | null>>> = {
  [VisitTargetType.PROJECT]: resolveProjectIdForProject,
  [VisitTargetType.SEQUENCE]: resolveProjectIdForSequence,
  [VisitTargetType.SHOT]: resolveProjectIdForShot,
  [VisitTargetType.ASSET]: resolveProjectIdForAsset,
  [VisitTargetType.TASK]: resolveProjectIdForTask,
  [VisitTargetType.MEDIA]: resolveProjectIdForMedia,
};

const targetTypeSchema = z.enum(['PROJECT', 'SEQUENCE', 'SHOT', 'ASSET', 'TASK', 'MEDIA']);

/** Types dont une liste porte un bouton « tout marquer comme lu ». */
const listTypeSchema = z.enum(['SEQUENCE', 'SHOT', 'ASSET']);

// POST /api/visits — j'ouvre cette entité : la lueur s'éteint pour moi seul.
router.post(
  '/',
  validate({
    body: z.object({
      targetType: targetTypeSchema,
      targetId: z.number().int().positive(),
    }),
  }),
  async (req, res) => {
    const { targetType, targetId } = req.body as {
      targetType: z.infer<typeof targetTypeSchema>;
      targetId: number;
    };
    const resolve = PROJECT_OF[targetType];
    const projectId = resolve ? await resolve(targetId) : null;
    if (!projectId) throw notFound('Target not found');
    await assertProjectAccess(req, projectId);
    const visitedAt = await EntityVisitService.markVisited(req.user!.id, targetType, targetId);
    res.json({ visitedAt: visitedAt.toISOString() });
  },
);

// POST /api/visits/mark-all — « tout marquer comme lu » pour une liste d'un projet.
router.post(
  '/mark-all',
  validate({
    body: z.object({
      targetType: listTypeSchema,
      projectId: z.number().int().positive(),
    }),
  }),
  async (req, res) => {
    const { targetType, projectId } = req.body as {
      targetType: z.infer<typeof listTypeSchema>;
      projectId: number;
    };
    await assertProjectAccess(req, projectId);
    // Les ids viennent de la base, jamais du corps de la requête (cf. le service).
    const ids = await EntityVisitService.visitableIdsOfProject(projectId, targetType);
    res.json({ marked: await EntityVisitService.markManyVisited(req.user!.id, targetType, ids) });
  },
);

export default router;
