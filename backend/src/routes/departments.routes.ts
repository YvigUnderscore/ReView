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
import * as DepartmentService from '../services/DepartmentService';

/**
 * Départements du pipeline (B1).
 *
 * Lecture ouverte aux comptes authentifiés : un département sert d'étiquette partout
 * (regroupements, filtres, badges). L'administration reste aux ADMIN et SUPERVISOR, comme
 * les autres réglages structurants du projet.
 */
const router = Router();

/**
 * ⚠ Ce routeur est monté sur `/api` (il porte plusieurs préfixes) : un `router.use(authenticate)`
 * s'appliquerait à **toute** requête traversant ce point de montage, routes publiques
 * comprises — le partage client répondait 401 au lieu de servir la page. L'authentification
 * est donc posée route par route.
 */
const auth = authenticate;

const manage = requireRole(Role.ADMIN, Role.SUPERVISOR);
const idParam = z.object({ id: z.coerce.number().int().positive() });
const projectParam = z.object({ projectId: z.coerce.number().int().positive() });
const idsBody = z.object({ ids: z.array(z.number().int().positive()).max(200) });
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a hex color (#RRGGBB)');

const departmentBody = z.object({
  name: z.string().min(1).max(60),
  key: z.string().min(1).max(40).optional(),
  order: z.number().int().min(0).optional(),
  color: colorSchema.nullish(),
});

/** Départements applicables à un projet : les siens, sinon ceux du studio. */
router.get('/projects/:projectId/departments', auth, validate({ params: projectParam }), async (req, res) => {
  res.json({ departments: await DepartmentService.listForProject(Number(req.params.projectId)) });
});

/** Référentiel du studio, celui que les projets héritent par défaut. */
router.get('/departments', auth, async (_req, res) => {
  const project = await prisma.project.findFirst({ select: { studioId: true } });
  res.json({ departments: project ? await DepartmentService.listForStudio(project.studioId) : [] });
});

router.post(
  '/projects/:projectId/departments',
  auth,
  manage,
  validate({ params: projectParam, body: departmentBody }),
  async (req, res) => {
    const projectId = Number(req.params.projectId);
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { studioId: true } });
    if (!project) throw notFound('Project not found');
    res
      .status(201)
      .json({ department: await DepartmentService.create(project.studioId, projectId, req.body) });
  },
);

router.post('/departments', auth, manage, validate({ body: departmentBody }), async (req, res) => {
  const project = await prisma.project.findFirst({ select: { studioId: true } });
  if (!project) throw notFound('No studio yet');
  res.status(201).json({ department: await DepartmentService.create(project.studioId, null, req.body) });
});

router.patch(
  '/departments/:id',
  auth,
  manage,
  validate({ params: idParam, body: departmentBody.partial() }),
  async (req, res) => {
    res.json({ department: await DepartmentService.update(Number(req.params.id), req.body) });
  },
);

/**
 * Image d'un département : dépôt direct dans MinIO, puis enregistrement de la clé.
 *
 * Même chemin qu'une vignette d'entité — c'est la seule façon de ne pas faire transiter
 * l'image par le serveur d'API, et la clé est reconstruite côté serveur pour qu'un
 * appelant ne puisse pas faire pointer un département vers un objet quelconque du bucket.
 */
router.post(
  '/departments/:id/image/presign',
  auth,
  manage,
  validate({ params: idParam, body: z.object({ contentType: z.string().min(3).max(100) }) }),
  async (req, res) => {
    res.json(await DepartmentService.presignImage(Number(req.params.id), req.body.contentType));
  },
);

router.put(
  '/departments/:id/image',
  auth,
  manage,
  validate({ params: idParam, body: z.object({ key: z.string().max(300).nullable() }) }),
  async (req, res) => {
    res.json({ department: await DepartmentService.setImage(Number(req.params.id), req.body.key) });
  },
);

router.delete('/departments/:id', auth, manage, validate({ params: idParam }), async (req, res) => {
  await DepartmentService.remove(Number(req.params.id));
  res.status(204).end();
});

router.put('/departments/order', auth, manage, validate({ body: idsBody }), async (req, res) => {
  await DepartmentService.reorder(req.body.ids);
  res.status(204).end();
});

/**
 * Départements que traverse une entité — le gabarit de ses tâches. La liste envoyée
 * remplace la précédente : l'appelant décrit l'état voulu, pas un delta.
 */
for (const [segment, holder] of [
  ['assets', 'asset'],
  ['shots', 'shot'],
  ['sequences', 'sequence'],
] as const) {
  router.put(
    `/${segment}/:id/departments`,
    auth,
    manage,
    validate({ params: idParam, body: idsBody }),
    async (req, res) => {
      await DepartmentService.setHolderDepartments(holder, Number(req.params.id), req.body.ids);
      res.status(204).end();
    },
  );

  /**
   * Cocher ou décocher un département sans réécrire la liste entière.
   *
   * Le `PUT` remplace tout : deux clics rapides dans un menu, et le second repart de la
   * liste d'avant le premier. La bascule au clic droit demande un ajout et un retrait
   * ciblés, qui ne peuvent pas se marcher dessus.
   */
  router.patch(
    `/${segment}/:id/departments`,
    auth,
    manage,
    validate({
      params: idParam,
      body: z.object({
        add: z.array(z.number().int().positive()).max(50).optional(),
        remove: z.array(z.number().int().positive()).max(50).optional(),
      }),
    }),
    async (req, res) => {
      const id = Number(req.params.id);
      await DepartmentService.attachHolderDepartments(holder, id, req.body.add ?? []);
      await DepartmentService.detachHolderDepartments(holder, id, req.body.remove ?? []);
      res.status(204).end();
    },
  );
}

/** Départements d'une personne : chacun règle les siens, un ADMIN règle ceux des autres. */
router.put('/users/me/departments', auth, validate({ body: idsBody }), async (req, res) => {
  await DepartmentService.setUserDepartments(req.user!.id, req.body.ids);
  res.status(204).end();
});

router.put(
  '/users/:id/departments',
  auth,
  requireRole(Role.ADMIN),
  validate({ params: idParam, body: idsBody }),
  async (req, res) => {
    await DepartmentService.setUserDepartments(Number(req.params.id), req.body.ids);
    res.status(204).end();
  },
);

export default router;
