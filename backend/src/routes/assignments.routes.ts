// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router, type Request } from 'express';
import { z } from 'zod';
import { authenticate, requireUser } from '../middleware/auth';
import { assertProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { resolveProjectIdForVersion } from '../lib/pipeline';
import { notFound } from '../lib/errors';
import { reviewNoteSchema } from '../lib/projectSettings';
import * as AssignmentService from '../services/AssignmentService';
import * as ReviewAssignmentService from '../services/ReviewAssignmentService';

/**
 * Assigning a person to an asset, a shot, or the review of a version.
 *
 * For an asset or a shot, the write targets the entity's tasks, never the entity itself: see
 * `AssignmentService` for why. Rights are checked in the service, on the resolved project: a project
 * supervisor whose account is ARTIST must be able to do it, which a `requireRole` on the global role
 * would refuse them.
 *
 * Reviewing a version is the third gesture, and the only one that creates nothing: it says "this is
 * yours to look at" (Phase 49), and shows up in the "Assigned to me" panel.
 */
const router = Router();

/**
 * ⚠ Router mounted on `/api` (it serves two prefixes): never `router.use(authenticate)`, which would
 * apply to every request crossing the mount point, public routes included. Authentication is set
 * route by route.
 */
const auth = authenticate;

const idParam = z.object({ id: z.coerce.number().int().positive() });
const assignBody = z.object({
  /** `null` unassigns. */
  userId: z.number().int().positive().nullable(),
  departmentIds: z.array(z.number().int().positive()).max(50).optional(),
});

for (const [segment, holder] of [
  ['assets', 'asset'],
  ['shots', 'shot'],
] as const) {
  router.post(
    `/${segment}/:id/assign`,
    auth,
    validate({ params: idParam, body: assignBody }),
    async (req, res) => {
      const result = await AssignmentService.assignEntity(requireUser(req), {
        holder,
        id: Number(req.params.id),
        userId: req.body.userId,
        departmentIds: req.body.departmentIds,
      });
      res.json(result);
    },
  );
}

/** Resolves a version's project and access assertion (RBAC), returns the projectId. */
async function resolveVersionAccess(req: Request, id: number): Promise<number> {
  const projectId = await resolveProjectIdForVersion(id);
  if (!projectId) throw notFound('Version not found');
  await assertProjectAccess(req, projectId);
  return projectId;
}

// GET /api/versions/:id/reviewers — who must look at this version (project members)
router.get('/versions/:id/reviewers', auth, validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  await resolveVersionAccess(req, id);
  res.json({ reviewers: await ReviewAssignmentService.listReviewers(id) });
});

/**
 * PUT /api/versions/:id/reviewers: entrusts the review to these people, instructions included.
 *
 * The right is read from the project's EFFECTIVE role (38.E), asserted by the service: a supervisor
 * named on the project must be able to distribute its reviews, an administrator passing through too,
 * and the account's global role says neither. The author of the version is entitled to it as well:
 * they are the one who knows what they have just delivered.
 */
router.put(
  '/versions/:id/reviewers',
  auth,
  validate({ params: idParam, body: z.object({ reviewers: ReviewAssignmentService.reviewersSchema }) }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await resolveVersionAccess(req, id);
    const reviewers = await ReviewAssignmentService.setReviewers(
      requireUser(req),
      projectId,
      id,
      req.body.reviewers,
    );
    res.json({ reviewers });
  },
);

/**
 * PATCH /api/versions/:id/reviewers/:userId: rewrites the instruction of a single person.
 *
 * The after-the-fact gesture, "add to what they should look at": resending the whole list to change
 * one sentence would have forced the screen to re-read it, and two open screens would have erased
 * each other.
 */
router.patch(
  '/versions/:id/reviewers/:userId',
  auth,
  validate({
    params: idParam.extend({ userId: z.coerce.number().int().positive() }),
    body: z.object({ note: reviewNoteSchema }),
  }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await resolveVersionAccess(req, id);
    const reviewers = await ReviewAssignmentService.updateNote(
      requireUser(req),
      projectId,
      id,
      Number(req.params.userId),
      req.body.note ?? null,
    );
    res.json({ reviewers });
  },
);

export default router;
