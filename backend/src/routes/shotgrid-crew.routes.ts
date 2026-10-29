// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireUser } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { assertProjectManager, canCreateStudioAccounts } from '../lib/shotgridAccess';
import { isMailerConfigured } from '../lib/mailer';
import * as Crew from '../services/shotgrid/ShotgridCrewService';

/**
 * The ShotGrid project's crew, and its entry into ReView.
 *
 * This router is mounted under `/api/shotgrid`, a segment of its own, and can therefore set
 * authentication once and for all.
 *
 * The list exposes addresses and the absence of an account: it is reserved to the project's managers,
 * without `allowMembers`.
 */
const router = Router();
router.use(authenticate);

const projectParam = z.object({ projectId: z.coerce.number().int().positive() });

router.get('/projects/:projectId/crew', validate({ params: projectParam }), async (req, res) => {
  const projectId = Number(req.params.projectId);
  await assertProjectManager(requireUser(req), projectId);
  const crew = await Crew.listCrew(projectId);
  res.json({
    crew,
    // The screen needs both to say what is possible BEFORE offering the gesture: without an email relay,
    // no invitation would be sent.
    canCreateAccounts: canCreateStudioAccounts(requireUser(req)),
    smtpReady: await isMailerConfigured(),
  });
});

router.post(
  '/projects/:projectId/crew/invite',
  validate({
    params: projectParam,
    // Deliberate ceiling: beyond it, this is a mass import that deserves to be done in several runs,
    // since each creation sends an email.
    body: z.object({ sgIds: z.array(z.number().int().positive()).min(1).max(50) }),
  }),
  async (req, res) => {
    const projectId = Number(req.params.projectId);
    await assertProjectManager(requireUser(req), projectId);
    const results = await Crew.inviteCrew(requireUser(req), projectId, req.body.sgIds, {
      canCreateAccounts: canCreateStudioAccounts(requireUser(req)),
    });
    res.json({ results });
  },
);

/**
 * Manually links a site account to a ReView account.
 *
 * Automatic matching goes through the address, which covers the usual case but leaves aside the people
 * whose address differs from one tool to another. `userId: null` undoes the link.
 */
router.put(
  '/projects/:projectId/crew/:sgId/link',
  validate({
    params: projectParam.extend({ sgId: z.coerce.number().int().positive() }),
    body: z.object({ userId: z.number().int().positive().nullable() }),
  }),
  async (req, res) => {
    const projectId = Number(req.params.projectId);
    await assertProjectManager(requireUser(req), projectId);
    await Crew.linkCrewMember(projectId, Number(req.params.sgId), req.body.userId);
    res.status(204).end();
  },
);

export default router;
