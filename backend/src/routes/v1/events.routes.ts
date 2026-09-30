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
 * Journal d'événements (API v1) — consommation par tirage.
 *
 * Un daemon de studio derrière un pare-feu ne peut pas recevoir de webhook : il vient
 * chercher. Le client conserve le dernier curseur reçu et le renvoie ; il ne perd rien
 * s'il redémarre, et ne relit rien deux fois. Sans curseur, la lecture démarre au présent
 * plutôt que de rejouer trente jours d'historique au premier appel.
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
  // Relecture typée : en Express 5 la coercition du middleware ne persiste pas.
  const q = readQuery(eventsQuery, req);

  const projectIds = await visibleProjectIds(req, q.project);
  const events = q.events
    ?.split(',')
    .map((e) => e.trim())
    .filter((e): e is (typeof WEBHOOK_EVENTS)[number] => (WEBHOOK_EVENTS as readonly string[]).includes(e));

  // Premier appel sans curseur : on se cale sur le présent. Le client repart de là.
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
 * Projets dont l'appelant peut lire les événements.
 * `undefined` = aucune restriction (manager global sans token cantonné) ; une liste vide
 * signifierait « rien » et n'est jamais renvoyée telle quelle par erreur.
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
