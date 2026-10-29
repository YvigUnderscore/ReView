// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { validate } from '../../middleware/validate';
import { requireScope } from '../../middleware/scope';
import { WEBHOOK_EVENTS } from '../../lib/webhooks';
import * as ApiEventService from '../../services/ApiEventService';
import * as Resolve from '../../services/PipelineResolveService';
import { assertProjectAccess } from '../../middleware/rbac';
import { assertTokenProject } from '../../middleware/scope';
import { readQuery } from './helpers';

/**
 * Event log (API v1): pull consumption.
 *
 * A studio daemon behind a firewall cannot receive webhooks: it fetches. The client keeps the
 * last cursor it received and sends it back; it loses nothing on restart and re-reads nothing
 * twice. Without a cursor, reading starts at the present rather than replaying thirty days of
 * history on the first call.
 */
const router = Router();

const eventsQuery = z.object({
  since: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  project: z.string().max(200).optional(),
  events: z.string().max(600).optional(),
});

// GET /api/v1/events?since=1234&project=PROJ&events=version.published,task.status_changed
router.get('/', requireScope('events:read'), validate({ query: eventsQuery }), async (req, res) => {
  // Typed re-read: under Express 5 the middleware's coercion does not persist.
  const q = readQuery(eventsQuery, req);

  const projectIds = await visibleProjectIds(req, q.project);
  const events = q.events
    ?.split(',')
    .map((e) => e.trim())
    .filter((e): e is (typeof WEBHOOK_EVENTS)[number] => (WEBHOOK_EVENTS as readonly string[]).includes(e));

  // First call without a cursor: start from the present. The client continues from there.
  if (q.since === undefined) {
    const last = await prisma.apiEvent.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
    res.json({ events: [], cursor: last?.id ?? 0, hasMore: false });
    return;
  }

  res.json(
    await ApiEventService.list({
      since: q.since,
      limit: q.limit,
      projectIds,
      events,
    }),
  );
});

/**
 * Projects the caller may read events for. `undefined` means no restriction (global manager without a scoped
 * token); an empty list would mean "nothing", and is never returned as such by mistake.
 */
async function visibleProjectIds(
  req: Parameters<typeof assertProjectAccess>[0],
  projectRef?: string,
): Promise<number[] | undefined> {
  if (projectRef) {
    const project = await Resolve.resolveProject(projectRef);
    await assertProjectAccess(req, project.id);
    assertTokenProject(req, project.id);
    return [project.id];
  }
  const bound = req.apiToken?.projectId;
  if (bound !== undefined) return [bound];

  const user = req.user!;
  if (user.role === Role.ADMIN || user.role === Role.SUPERVISOR) return undefined;
  const memberships = await prisma.projectMembership.findMany({
    where: { userId: user.id },
    select: { projectId: true },
  });
  return memberships.map((m) => m.projectId);
}

export default router;
