// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate';
import { requireScope } from '../../middleware/scope';
import type { Scope } from '../../lib/apiScopes';
import * as EntityAssigneeService from '../../services/EntityAssigneeService';
import * as EntityNoteService from '../../services/EntityNoteService';
import {
  actorOf,
  idParam,
  requireAssetProject,
  requireEpisodeProject,
  requireSequenceProject,
  requireShotProject,
} from './helpers';

/**
 * What a pipeline entity carries beyond its technical sheet: who is responsible for it, and
 * its brief.
 *
 * Both already existed on `/api` but never reached the integration API, although they are
 * exactly the two fields a pipeline wants to read before opening a shot: who it is assigned
 * to, and what production expects of it. A tool had to open the browser to look them up.
 *
 * The four levels are handled the same way, hence the factories below, which only differ in
 * the access guard and the required scope.
 */
const router = Router();

/** Addressable level, its project guard and the scope protecting it. */
const LEVELS = {
  episodes: { kind: 'episode', guard: requireEpisodeProject, domain: 'episodes' },
  sequences: { kind: 'sequence', guard: requireSequenceProject, domain: 'sequences' },
  shots: { kind: 'shot', guard: requireShotProject, domain: 'shots' },
  assets: { kind: 'asset', guard: requireAssetProject, domain: 'assets' },
} as const;

type Level = (typeof LEVELS)[keyof typeof LEVELS];
type Guard = (req: Request, id: number) => Promise<number>;

/**
 * An episode has no write domain: the level is read from the integration API and composed
 * from the UI. Writing its brief or its owners therefore goes through the sequence scope,
 * the tier it groups.
 */
const writeScope = (domain: Level['domain']): Scope =>
  domain === 'episodes' ? 'sequences:write' : (`${domain}:write` as Scope);

const readAssignees =
  (kind: Level['kind'], guard: Guard): RequestHandler =>
  async (req, res) => {
    const id = Number(req.params.id);
    await guard(req, id);
    res.json({ assignees: await EntityAssigneeService.scopeAssignees(kind, id) });
  };

const writeAssignees =
  (kind: Level['kind'], guard: Guard): RequestHandler =>
  async (req, res) => {
    const id = Number(req.params.id);
    await guard(req, id);
    const assignees = await EntityAssigneeService.setAssignees(actorOf(req), kind, id, req.body.userIds);
    res.json({ assignees });
  };

const readNote =
  (kind: Level['kind'], guard: Guard): RequestHandler =>
  async (req, res) => {
    const id = Number(req.params.id);
    await guard(req, id);
    res.json({ note: await EntityNoteService.getNote(kind, id) });
  };

const writeNote =
  (kind: Level['kind'], guard: Guard): RequestHandler =>
  async (req, res) => {
    const id = Number(req.params.id);
    await guard(req, id);
    res.json({ note: await EntityNoteService.setNote(actorOf(req), kind, id, req.body.body) });
  };

const assigneesBody = z.object({
  userIds: z
    .array(z.number().int().positive())
    .max(50)
    .describe('Remplace la liste : les personnes absentes du tableau sont retirées.'),
});

const noteBody = z.object({
  body: z
    .string()
    .max(50_000)
    .describe('Brief en markdown. Une chaîne vide supprime la fiche plutôt que de la garder vide.'),
});

for (const [segment, level] of Object.entries(LEVELS) as [keyof typeof LEVELS, Level][]) {
  const read: Scope = `${level.domain}:read` as Scope;
  const write = writeScope(level.domain);

  router.get(
    `/${segment}/:id/assignees`,
    requireScope(read),
    validate({ params: idParam }),
    readAssignees(level.kind, level.guard),
  );
  router.put(
    `/${segment}/:id/assignees`,
    requireScope(write),
    validate({ params: idParam, body: assigneesBody }),
    writeAssignees(level.kind, level.guard),
  );
  router.get(
    `/${segment}/:id/note`,
    requireScope(read),
    validate({ params: idParam }),
    readNote(level.kind, level.guard),
  );
  router.put(
    `/${segment}/:id/note`,
    requireScope(write),
    validate({ params: idParam, body: noteBody }),
    writeNote(level.kind, level.guard),
  );
}

export default router;
