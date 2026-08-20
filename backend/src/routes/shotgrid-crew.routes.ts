// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { assertProjectManager, canCreateStudioAccounts } from '../lib/shotgridAccess';
import { isMailerConfigured } from '../lib/mailer';
import * as Crew from '../services/shotgrid/ShotgridCrewService';

/**
 * L'équipe du projet ShotGrid, et son entrée dans ReView.
 *
 * Ce routeur est monté sous `/api/shotgrid` — un segment qui lui est propre — et peut donc
 * poser l'authentification une fois pour toutes.
 *
 * La liste expose des adresses et l'absence de compte : elle est réservée aux gestionnaires
 * du projet, sans `allowMembers`.
 */
const router = Router();
router.use(authenticate);

const projectParam = z.object({ projectId: z.coerce.number().int().positive() });

router.get('/projects/:projectId/crew', validate({ params: projectParam }), async (req, res) => {
  const projectId = Number(req.params.projectId);
  await assertProjectManager(req.user!, projectId);
  const crew = await Crew.listCrew(projectId);
  res.json({
    crew,
    // L'écran a besoin des deux pour dire ce qui est possible AVANT de proposer le geste :
    // sans relais courriel, aucune invitation ne partira.
    canCreateAccounts: canCreateStudioAccounts(req.user!),
    smtpReady: await isMailerConfigured(),
  });
});

router.post(
  '/projects/:projectId/crew/invite',
  validate({
    params: projectParam,
    // Plafond volontaire : au-delà, c'est un import massif qui mérite d'être fait en
    // plusieurs fois, et chaque création envoie un courriel.
    body: z.object({ sgIds: z.array(z.number().int().positive()).min(1).max(50) }),
  }),
  async (req, res) => {
    const projectId = Number(req.params.projectId);
    await assertProjectManager(req.user!, projectId);
    const results = await Crew.inviteCrew(req.user!, projectId, req.body.sgIds, {
      canCreateAccounts: canCreateStudioAccounts(req.user!),
    });
    res.json({ results });
  },
);

export default router;
