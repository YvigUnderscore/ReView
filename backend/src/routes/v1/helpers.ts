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
  resolveProjectIdForEpisode,
  resolveProjectIdForSequence,
} from '../../lib/pipeline';
import { notFound } from '../../lib/errors';
import * as Resolve from '../../services/PipelineResolveService';
import { requireUser } from '../../middleware/auth';

/**
 * Access guard shared by the v1 routes.
 *
 * Three checks, always in this order: the entity exists, the bearer has access to the project,
 * and the token is not scoped to another project. Factoring them out prevents a route added
 * later from forgetting one, which is exactly how one project's data leaks into a neighbour's.
 */

/** Entity reference accepted in a URL: identifier, code or name. */
export const refParam = z.object({ ref: z.string().min(1).max(200) });
export const idParam = z.object({ id: z.coerce.number().int().positive() });

/**
 * Re-reads `req.query` through its schema to obtain typed values.
 *
 * Under Express 5, `req.query` is a getter: the coercion done by the `validate` middleware does
 * not persist, and everything comes out as a string. A `since=8` thus reached Prisma as `"8"`,
 * and `resolved=false` was a non-empty string, hence truthy. v1 routes therefore always read
 * their query through here.
 */
export const readQuery = <T extends z.ZodTypeAny>(schema: T, req: Request): z.infer<T> =>
  schema.parse(req.query);

/** Resolves a project by reference and checks access. */
export async function requireProject(req: Request, ref: string) {
  const project = await Resolve.resolveProject(ref);
  await assertProjectAccess(req, project.id);
  assertTokenProject(req, project.id);
  return project;
}

/**
 * Access to a project designated directly by its identifier (query or body), with no
 * intermediate entity to resolve. The same two checks as everywhere else: a route that reads a
 * raw `projectId` without them makes token scoping meaningless.
 */
export async function requireProjectId(req: Request, projectId: number): Promise<number> {
  await assertProjectAccess(req, projectId);
  assertTokenProject(req, projectId);
  return projectId;
}

type Resolver = (id: number) => Promise<number | null>;

/** Checks access to the project owning an entity, designated by its identifier. */
async function requireOwningProject(req: Request, id: number, resolve: Resolver, label: string) {
  const projectId = await resolve(id);
  if (!projectId) throw notFound(`${label} not found`);
  await assertProjectAccess(req, projectId);
  assertTokenProject(req, projectId);
  return projectId;
}

export const requireEpisodeProject = (req: Request, id: number) =>
  requireOwningProject(req, id, resolveProjectIdForEpisode, 'Episode');

export const requireSequenceProject = (req: Request, id: number) =>
  requireOwningProject(req, id, resolveProjectIdForSequence, 'Sequence');

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

/** Actor of the write, as the business services expect it. */
export const actorOf = (req: Request) => ({ id: requireUser(req).id, role: requireUser(req).role });

/** Pagination and sort query shared by v1 collections; extend with filters. */
export const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(100),
  sort: z.string().max(40).optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});
