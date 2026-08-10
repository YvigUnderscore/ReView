// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request } from 'express';
import { z } from 'zod';
import { assertProjectAccess } from '../../middleware/rbac';
import { assertTokenProject } from '../../middleware/scope';
import {
  resolveProjectIdForTask,
  resolveProjectIdForVersion,
  resolveProjectIdForMedia,
  resolveProjectIdForShot,
  resolveProjectIdForAsset,
} from '../../lib/pipeline';
import { notFound } from '../../lib/errors';
import * as Resolve from '../../services/PipelineResolveService';

/**
 * Garde d'accès commune aux routes v1.
 *
 * Trois vérifications systématiques, dans cet ordre : l'entité existe, le porteur a accès
 * au projet, et le token n'est pas cantonné à un autre projet. Les factoriser évite qu'une
 * route ajoutée plus tard n'en oublie une — c'est exactement ainsi que fuient les données
 * d'un projet voisin.
 */

/** Référence d'entité acceptée dans une URL : identifiant, code ou nom. */
export const refParam = z.object({ ref: z.string().min(1).max(200) });
export const idParam = z.object({ id: z.coerce.number().int().positive() });

/**
 * Relit `req.query` à travers son schéma pour obtenir des valeurs typées.
 *
 * En Express 5, `req.query` est un getter : la coercition effectuée par le middleware
 * `validate` ne persiste pas, et tout ressort en chaîne de caractères. Un `since=8`
 * arrivait ainsi jusqu'à Prisma sous la forme `"8"`, et `resolved=false` était une chaîne
 * — donc vraie. Les routes v1 lisent donc systématiquement leur query par ici.
 */
export const readQuery = <T extends z.ZodTypeAny>(schema: T, req: Request): z.infer<T> =>
  schema.parse(req.query);

/** Résout un projet par référence et vérifie l'accès. */
export async function requireProject(req: Request, ref: string) {
  const project = await Resolve.resolveProject(ref);
  await assertProjectAccess(req, project.id);
  assertTokenProject(req, project.id);
  return project;
}

type Resolver = (id: number) => Promise<number | null>;

/** Vérifie l'accès au projet propriétaire d'une entité, désignée par son identifiant. */
async function requireOwningProject(req: Request, id: number, resolve: Resolver, label: string) {
  const projectId = await resolve(id);
  if (!projectId) throw notFound(`${label} introuvable`);
  await assertProjectAccess(req, projectId);
  assertTokenProject(req, projectId);
  return projectId;
}

export const requireShotProject = (req: Request, id: number) =>
  requireOwningProject(req, id, resolveProjectIdForShot, 'Shot');

export const requireAssetProject = (req: Request, id: number) =>
  requireOwningProject(req, id, resolveProjectIdForAsset, 'Asset');

export const requireTaskProject = (req: Request, id: number) =>
  requireOwningProject(req, id, resolveProjectIdForTask, 'Tâche');

export const requireVersionProject = (req: Request, id: number) =>
  requireOwningProject(req, id, resolveProjectIdForVersion, 'Version');

export const requireMediaProject = (req: Request, id: number) =>
  requireOwningProject(req, id, resolveProjectIdForMedia, 'Média');

/** Acteur de l'écriture, tel que les services métier l'attendent. */
export const actorOf = (req: Request) => ({ id: req.user!.id, role: req.user!.role });

/** Query de pagination et de tri commune aux collections v1 — à étendre par filtre. */
export const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(100),
  sort: z.string().max(40).optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});
