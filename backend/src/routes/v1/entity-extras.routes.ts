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
 * Ce qu'une entité de pipeline porte en plus de sa fiche technique : qui en répond, et son
 * brief.
 *
 * Les deux existaient sur `/api` sans jamais atteindre l'API d'intégration, alors que ce
 * sont précisément les deux champs qu'un pipeline veut lire avant d'ouvrir un plan : à qui
 * il est confié, et ce que la production en attend. Un outil devait ouvrir le navigateur
 * pour les consulter.
 *
 * Les quatre niveaux se traitent de la même façon — d'où les fabriques ci-dessous, qui ne
 * diffèrent que par la garde d'accès et le scope exigé.
 */
const router = Router();

/** Niveau adressable, sa garde de projet et le scope qui le protège. */
const LEVELS = {
  episodes: { kind: 'episode', guard: requireEpisodeProject, domain: 'episodes' },
  sequences: { kind: 'sequence', guard: requireSequenceProject, domain: 'sequences' },
  shots: { kind: 'shot', guard: requireShotProject, domain: 'shots' },
  assets: { kind: 'asset', guard: requireAssetProject, domain: 'assets' },
} as const;

type Level = (typeof LEVELS)[keyof typeof LEVELS];
type Guard = (req: Request, id: number) => Promise<number>;

/**
 * Un épisode n'a pas de domaine d'écriture : le niveau se lit depuis l'API
 * d'intégration, il se compose depuis l'interface. Écrire son brief ou ses responsables
 * passe donc par le scope de la séquence, le cran qu'il regroupe.
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
