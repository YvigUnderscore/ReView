// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate';
import { requireScope } from '../../middleware/scope';
import { reviewNoteSchema } from '../../lib/projectSettings';
import * as ReviewAssignmentService from '../../services/ReviewAssignmentService';
import * as ReviewDecisionService from '../../services/ReviewDecisionService';
import { actorOf, idParam, requireProjectId, requireVersionProject } from './helpers';

/**
 * The review round, integration side: who must look at what, and what the studio concluded.
 *
 * Three gaps this family closes. `POST /versions/{id}/decision` had existed since Phase 31 and
 * requires a `statusId`, yet no v1 route allowed DISCOVERING these identifiers: an integrator read
 * them from the database or hard-coded them, and a studio renaming its vocabulary broke the script.
 * The decision history, which every production report queries, was returned nowhere. And review
 * assignment (Phase 49) lived only on the web API, although it is exactly what a production bot wants
 * to write after a night render.
 */
const router = Router();

const reviewerParam = idParam.extend({ userId: z.coerce.number().int().positive() });
const note = reviewNoteSchema.describe(
  'Ce que cette personne doit regarder. Le projet peut l’exiger et lui imposer une ' +
    'longueur minimale (GET /api/v1/projects/{ref}/settings, section « reviewRequest ») : ' +
    'une consigne manquante ou trop courte refuse alors l’écriture.',
);

// ── Who the review of a version is assigned to ───────────────────────────────

router.get(
  '/versions/:id/reviewers',
  requireScope('versions:read'),
  validate({ params: idParam }),
  async (req, res) => {
    const id = Number(req.params.id);
    await requireVersionProject(req, id);
    res.json({ reviewers: await ReviewAssignmentService.listReviewers(id) });
  },
);

/**
 * PUT /api/v1/versions/{id}/reviewers: replaces the list, briefs included.
 *
 * Replacement, not addition: a script describes the desired state ("these three"), it does not build
 * a list by accumulation. Reserved to the project manager and the version's author, as in the UI.
 */
router.put(
  '/versions/:id/reviewers',
  requireScope('versions:write'),
  validate({ params: idParam, body: z.object({ reviewers: ReviewAssignmentService.reviewersSchema }) }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await requireVersionProject(req, id);
    const reviewers = await ReviewAssignmentService.setReviewers(
      actorOf(req),
      projectId,
      id,
      req.body.reviewers,
    );
    res.json({ reviewers });
  },
);

// PATCH /api/v1/versions/{id}/reviewers/{userId}: rewrites the brief of a single person.
router.patch(
  '/versions/:id/reviewers/:userId',
  requireScope('versions:write'),
  validate({ params: reviewerParam, body: z.object({ note }) }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await requireVersionProject(req, id);
    const reviewers = await ReviewAssignmentService.updateNote(
      actorOf(req),
      projectId,
      id,
      Number(req.params.userId),
      req.body.note ?? null,
    );
    res.json({ reviewers });
  },
);

// ── Vocabulary and decision history ──────────────────────────────────────────

/**
 * GET /api/v1/review-statuses: the statuses the studio uses, and their identifiers.
 *
 * `projectId` restricts the list to the vocabulary actually postable on that project: on a project
 * linked to ShotGrid, only statuses with a counterpart on the site are offered, and posting another
 * would go nowhere.
 */
router.get(
  '/review-statuses',
  requireScope('versions:read'),
  validate({ query: z.object({ projectId: z.coerce.number().int().positive().optional() }) }),
  async (req, res) => {
    // Express 5: validation merges, it does not replace; the value remains a string.
    const raw = req.query.projectId;
    const projectId = raw === undefined ? undefined : Number(raw);
    if (!projectId || !Number.isInteger(projectId))
      return res.json({ statuses: await ReviewDecisionService.listStatuses() });
    // The only v1 route that read a `projectId` without going through the common guards: a token
    // scoped to project X could learn project Y's vocabulary, and therefore its existence and its
    // ShotGrid link.
    await requireProjectId(req, projectId);
    res.json({ statuses: await ReviewDecisionService.listStatusesForProject(projectId) });
  },
);

// GET /api/v1/versions/{id}/decisions: the history, from newest to oldest.
router.get(
  '/versions/:id/decisions',
  requireScope('versions:read'),
  validate({ params: idParam }),
  async (req, res) => {
    const id = Number(req.params.id);
    await requireVersionProject(req, id);
    res.json({ decisions: await ReviewDecisionService.history(id) });
  },
);

export default router;
