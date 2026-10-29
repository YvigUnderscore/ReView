// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Router } from 'express';
import type { z } from 'zod';
import type { Schemas } from './requestSchemas';
import type { Scope } from './apiScopes';

/**
 * Introspection of Express routers for documentation (API v1) — PURE helpers.
 *
 * Describing three hundred endpoints by hand produces wrong documentation within a few weeks: the route changes, the doc
 * stays. So we read the routers themselves, and the Zod schemas that `middleware/validate` attaches to its middlewares.
 * The spec cannot then diverge from the code — it is extracted from it.
 *
 * Express 5 no longer keeps the prefix of a sub-router (it lives in a closure of `path-to-regexp`): the prefix is supplied
 * by the mount table, the only source of truth for the URL plan.
 */

export interface RouteDescriptor {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  /** Path in OpenAPI format: `/api/v1/shots/{id}`. */
  path: string;
  schemas: Schemas;
  scope?: Scope;
}

const DOCUMENTED_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/** Converts an Express path (`/shots/:id`) into an OpenAPI template (`/shots/{id}`). */
export const toOpenApiPath = (path: string): string =>
  path.replace(/:([A-Za-z0-9_]+)/g, (_m, name: string) => `{${name}}`);

/** Concatenates prefix and path without producing a double slash or a trailing slash. */
export function joinPaths(...parts: string[]): string {
  const joined = parts
    .map((p) => p.replace(/^\/+|\/+$/g, ''))
    .filter((p) => p.length > 0)
    .join('/');
  return `/${joined}`;
}

/** Metadata attached to the middlewares by `validate` and `requireScope`. */
type AnnotatedHandler = { schemas?: Schemas; scope?: Scope };

/** Minimal shape of the Express router the introspection depends on. */
interface RouterLike {
  stack?: {
    route?: {
      path: string | string[];
      methods: Record<string, boolean>;
      stack: { handle: AnnotatedHandler }[];
    };
  }[];
}

/**
 * Extracts the routes of a router, prefix included.
 * A route declared on several paths produces one entry per path.
 */
export function describeRouter(router: Router, prefix: string): RouteDescriptor[] {
  const out: RouteDescriptor[] = [];
  for (const layer of (router as unknown as RouterLike).stack ?? []) {
    const route = layer.route;
    if (!route) continue;

    const schemas: Schemas = {};
    let scope: Scope | undefined;
    for (const { handle } of route.stack) {
      if (handle.schemas) Object.assign(schemas, handle.schemas);
      if (handle.scope) scope = handle.scope;
    }

    const paths = Array.isArray(route.path) ? route.path : [route.path];
    for (const path of paths) {
      for (const method of DOCUMENTED_METHODS) {
        if (route.methods[method]) {
          out.push({ method, path: toOpenApiPath(joinPaths(prefix, path)), schemas, scope });
        }
      }
    }
  }
  return out;
}

/** Applies `describeRouter` to a mount table, in the declared order. */
export function describeMounts(
  base: string,
  mounts: { prefix: string; router: Router }[],
): RouteDescriptor[] {
  return mounts.flatMap(({ prefix, router }) => describeRouter(router, joinPaths(base, prefix)));
}

/**
 * Readable summary of a Zod schema for the cases zod-to-openapi cannot convert (refinements, exotic unions).
 * An open type is better than a missing endpoint.
 */
export const isConvertible = (schema: z.ZodTypeAny | undefined): schema is z.ZodTypeAny =>
  schema !== undefined;
