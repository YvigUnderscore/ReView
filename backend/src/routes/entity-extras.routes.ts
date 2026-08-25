// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notFound } from '../lib/errors';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { NOTE_KINDS, TEMPLATE_SCOPES } from '../services/EntityNoteService';
import * as EntityNoteService from '../services/EntityNoteService';
import * as EntityAssigneeService from '../services/EntityAssigneeService';

/**
 * Ce qu'une entité de pipeline porte en plus de sa fiche technique : les personnes qui en
 * répondent, et son brief markdown.
 *
 * Les deux sont regroupés parce qu'ils partagent la même forme d'adressage
 * (`/api/:kind/:id/...`) et le même contrôle d'accès. Les séparer aurait dupliqué le
 * schéma de paramètres et le garde-fou de rôle sans rien clarifier.
 */
const router = Router();

/** ⚠ Monté sur `/api` : authentification route par route, jamais `router.use`. */
const auth = authenticate;
const manage = requireRole(Role.ADMIN, Role.SUPERVISOR);

/**
 * Le segment d'URL de chaque type, au pluriel comme partout ailleurs dans l'API.
 * `episode` reste au singulier côté service : c'est le nom du modèle.
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
  // ── Personnes responsables ────────────────────────────────────────────────
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
   * Tout le monde du périmètre : l'entité, ses enfants et les tâches. C'est ce que
   * l'en-tête dépliable d'une page de séquence montre — s'arrêter à la séquence
   * elle-même n'aurait montré personne dans le cas courant.
   */
  router.get(`/${segment}/:id/assignees`, auth, validate({ params: idParam }), async (req, res) => {
    res.json({ assignees: await EntityAssigneeService.scopeAssignees(kind, Number(req.params.id)) });
  });

  // ── Fiche markdown ────────────────────────────────────────────────────────
  router.get(`/${segment}/:id/note`, auth, validate({ params: idParam }), async (req, res) => {
    res.json({ note: await EntityNoteService.getNote(kind, Number(req.params.id)) });
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

// ── Modèles de fiche ────────────────────────────────────────────────────────

/** Le studio de l'instance — une instance = un studio. */
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

/** Les types de fiche connus — sert au contrôle de cohérence des tests et de l'API. */
export const NOTE_SEGMENTS = Object.keys(SEGMENTS) as (keyof typeof SEGMENTS)[];
export { NOTE_KINDS };

export default router;
