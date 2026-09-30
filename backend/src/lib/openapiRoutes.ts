// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Router } from 'express';
import type { z } from 'zod';
import type { Schemas } from '../middleware/validate';
import type { Scope } from './apiScopes';

/**
 * Introspection des routeurs Express pour la documentation (API v1) — helpers PURS.
 *
 * Décrire trois cents endpoints à la main produit une documentation fausse au bout de
 * quelques semaines : la route change, la doc reste. On lit donc les routeurs eux-mêmes,
 * et les schémas Zod que `middleware/validate` accroche à ses middlewares. La spec ne
 * peut alors pas diverger du code — elle en est extraite.
 *
 * Express 5 ne conserve plus le préfixe d'un sous-routeur (il vit dans une closure de
 * `path-to-regexp`) : le préfixe est fourni par la table de montage, seule source de
 * vérité du plan d'URL.
 */

export interface RouteDescriptor {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  /** Chemin au format OpenAPI : `/api/v1/shots/{id}`. */
  path: string;
  schemas: Schemas;
  scope?: Scope;
}

const DOCUMENTED_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/** Convertit un chemin Express (`/shots/:id`) en gabarit OpenAPI (`/shots/{id}`). */
export const toOpenApiPath = (path: string): string =>
  path.replace(/:([A-Za-z0-9_]+)/g, (_m, name: string) => `{${name}}`);

/** Concatène préfixe et chemin sans produire de double barre ni de barre finale. */
export function joinPaths(...parts: string[]): string {
  const joined = parts
    .map((p) => p.replace(/^\/+|\/+$/g, ''))
    .filter((p) => p.length > 0)
    .join('/');
  return `/${joined}`;
}

/** Métadonnées accrochées aux middlewares par `validate` et `requireScope`. */
type AnnotatedHandler = { schemas?: Schemas; scope?: Scope };

/** Forme minimale du routeur Express dont dépend l'introspection. */
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
 * Extrait les routes d'un routeur, préfixe compris.
 * Une route déclarée sur plusieurs chemins produit une entrée par chemin.
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

/** Applique `describeRouter` à une table de montage, dans l'ordre déclaré. */
export function describeMounts(
  base: string,
  mounts: { prefix: string; router: Router }[],
): RouteDescriptor[] {
  return mounts.flatMap(({ prefix, router }) => describeRouter(router, joinPaths(base, prefix)));
}

/**
 * Résumé lisible d'un schéma Zod pour les cas que zod-to-openapi ne sait pas convertir
 * (raffinements, unions exotiques). Mieux vaut un type ouvert qu'un endpoint absent.
 */
export const isConvertible = (schema: z.ZodTypeAny | undefined): schema is z.ZodTypeAny =>
  schema !== undefined;
