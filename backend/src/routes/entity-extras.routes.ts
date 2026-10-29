// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notFound } from '../lib/errors';
import { authenticate } from '../middleware/auth';
import { assertProjectAccess, requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { NOTE_KINDS, TEMPLATE_SCOPES } from '../services/EntityNoteService';
import * as EntityNoteService from '../services/EntityNoteService';
import * as EntityAssigneeService from '../services/EntityAssigneeService';

/**
 * What a pipeline entity carries in addition to its technical record: the people who answer for it,
 * and its markdown brief.
 *
 * Both are grouped because they share the same addressing form (`/api/:kind/:id/...`) and the same
 * access control. Separating them would have duplicated the parameter schema and the role guard
 * without clarifying anything.
 */
const router = Router();

/** ⚠ Mounted on `/api`: authentication route by route, never `router.use`. */
const auth = authenticate;
const manage = requireRole(Role.ADMIN, Role.SUPERVISOR);

/**
 * The URL segment of each type, in the plural as everywhere else in the API.
 * `episode` stays singular on the service side: it is the model's name.
 */
const SEGMENTS = {
  episodes: 'episode',
  sequences: 'sequence',
  shots: 'shot',
  assets: 'asset',
} as const;

const idParam = z.object({ id: z.coerce.number().int().positive() });

for (const [segment, kind] of Object.entries(SEGMENTS) as [
  keyof typeof SEGMENTS,
  (typeof SEGMENTS)[keyof typeof SEGMENTS],
][]) {
  // ── Responsible people ────────────────────────────────────────────────
  router.put(
    `/${segment}/:id/assignees`,
    auth,
    manage,
    validate({
      params: idParam,
      body: z.object({ userIds: z.array(z.number().int().positive()).max(50) }),
    }),
    async (req, res) => {
      const assignees = await EntityAssigneeService.setAssignees(
        req.user!,
        kind,
        Number(req.params.id),
        req.body.userIds,
      );
      res.json({ assignees });
    },
  );

  /**
   * Everyone in the scope: the entity, its children and the tasks. This is what the expandable header
   * of a sequence page shows: stopping at the sequence itself would have shown nobody in the usual case.
   */
  router.get(`/${segment}/:id/assignees`, auth, validate({ params: idParam }), async (req, res) => {
    const id = Number(req.params.id);
    // Reading an entity's team is reading the project: without this guard, any account would enumerate
    // identifiers and retrieve the make-up of the whole studio.
    await assertProjectAccess(req, await EntityNoteService.resolveProject(kind, id));
    res.json({ assignees: await EntityAssigneeService.scopeAssignees(kind, id) });
  });

  // ── Markdown sheet ────────────────────────────────────────────────────────
  router.get(`/${segment}/:id/note`, auth, validate({ params: idParam }), async (req, res) => {
    const id = Number(req.params.id);
    // Same guard as reading the sheet's images (note-images.routes): the brief's text must not be
    // more exposed than the images it contains.
    await assertProjectAccess(req, await EntityNoteService.resolveProject(kind, id));
    res.json({ note: await EntityNoteService.getNote(kind, id) });
  });

  router.put(
    `/${segment}/:id/note`,
    auth,
    manage,
    validate({ params: idParam, body: z.object({ body: z.string().max(100_000) }) }),
    async (req, res) => {
      res.json({
        note: await EntityNoteService.setNote(req.user!, kind, Number(req.params.id), req.body.body),
      });
    },
  );
}

// ── Record templates ────────────────────────────────────────────────────────

/** The studio of the instance: one instance equals one studio. */
async function currentStudioId(): Promise<number> {
  const project = await prisma.project.findFirst({ select: { studioId: true } });
  if (!project) throw notFound('No studio yet');
  return project.studioId;
}

const templateBody = z.object({
  projectId: z.number().int().positive().nullish(),
  scope: z.enum(TEMPLATE_SCOPES),
  name: z.string().min(1).max(80),
  body: z.string().max(100_000),
});

router.get(
  '/note-templates',
  auth,
  validate({
    query: z.object({
      projectId: z.coerce.number().int().positive().optional(),
      scope: z.enum(TEMPLATE_SCOPES).optional(),
    }),
  }),
  async (req, res) => {
    const studioId = await currentStudioId();
    const projectId = req.query.projectId === undefined ? null : Number(req.query.projectId);
    // A record template can be specific to a project: asking for those of a project one does not
    // belong to would amount to reading its content.
    if (projectId !== null) await assertProjectAccess(req, projectId);
    const scope = req.query.scope as (typeof TEMPLATE_SCOPES)[number] | undefined;
    res.json({ templates: await EntityNoteService.listTemplates(studioId, projectId, scope) });
  },
);

router.post('/note-templates', auth, manage, validate({ body: templateBody }), async (req, res) => {
  const studioId = await currentStudioId();
  res
    .status(201)
    .json({ template: await EntityNoteService.createTemplate(studioId, req.user!.id, req.body) });
});

router.patch(
  '/note-templates/:id',
  auth,
  manage,
  validate({ params: idParam, body: templateBody.partial() }),
  async (req, res) => {
    const studioId = await currentStudioId();
    res.json({
      template: await EntityNoteService.updateTemplate(studioId, Number(req.params.id), req.body),
    });
  },
);

router.delete('/note-templates/:id', auth, manage, validate({ params: idParam }), async (req, res) => {
  const studioId = await currentStudioId();
  await EntityNoteService.deleteTemplate(studioId, Number(req.params.id));
  res.status(204).end();
});

/** Known record types: used by the consistency check of the tests and by the API. */
export const NOTE_SEGMENTS = Object.keys(SEGMENTS) as (keyof typeof SEGMENTS)[];
export { NOTE_KINDS };

export default router;
