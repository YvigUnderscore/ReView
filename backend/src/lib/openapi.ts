// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { extendZodWithOpenApi, OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { paginationQuery } from './pagination';

/**
 * Génération OpenAPI 3.0 depuis les schémas Zod (10.D6).
 *
 * `extendZodWithOpenApi` ajoute `.openapi()` à Zod : les schémas de validation sont
 * la source de vérité de la doc. Les routes sont enregistrées dans le `registry`
 * ci-dessous, puis `buildOpenApiDocument()` produit le document servi sur
 * `/api/openapi.json` et rendu par Scalar sur `/api/docs`.
 *
 * Couverture initiale : santé, auth, projets (CRUD + liste paginée). Étendre en
 * enregistrant de nouveaux chemins ici (aucune duplication : on réutilise les schémas
 * partagés comme `paginationQuery`).
 */
extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
});

const ErrorResponse = registry.register(
  'ErrorResponse',
  z.object({ error: z.string(), code: z.string().optional() }).openapi('ErrorResponse'),
);

const Project = registry.register(
  'Project',
  z
    .object({
      id: z.number(),
      name: z.string(),
      slug: z.string(),
      status: z.string(),
      description: z.string().nullable(),
      startFrame: z.number(),
      thumbnailUrl: z.string().nullable().optional(),
    })
    .openapi('Project'),
);

/** Enveloppe de liste paginée standard (10.D1). */
function pageEnvelope<T extends z.ZodTypeAny>(item: T, name: string) {
  return z
    .object({ items: z.array(item), total: z.number(), page: z.number(), pageSize: z.number() })
    .openapi(name);
}

const jsonError = (description: string) => ({
  description,
  content: { 'application/json': { schema: ErrorResponse } },
});

// ── Santé ────────────────────────────────────────────────────────────────────
registry.registerPath({
  method: 'get',
  path: '/health',
  summary: 'Sonde de vivacité',
  responses: {
    200: {
      description: 'Service opérationnel',
      content: { 'application/json': { schema: z.object({ status: z.literal('ok') }) } },
    },
  },
});

// ── Auth ─────────────────────────────────────────────────────────────────────
const LoginBody = z.object({ email: z.string().email(), password: z.string().min(1) }).openapi('LoginBody');
const LoginResponse = z
  .object({ token: z.string(), user: z.object({ id: z.number(), email: z.string(), role: z.string() }) })
  .openapi('LoginResponse');

registry.registerPath({
  method: 'post',
  path: '/api/auth/login',
  summary: 'Authentification (JWT)',
  request: { body: { content: { 'application/json': { schema: LoginBody } } } },
  responses: {
    200: { description: 'Jeton + utilisateur', content: { 'application/json': { schema: LoginResponse } } },
    401: jsonError('Identifiants invalides'),
  },
});

// ── Projets ──────────────────────────────────────────────────────────────────
registry.registerPath({
  method: 'get',
  path: '/api/projects',
  summary: 'Liste paginée des projets accessibles',
  security: [{ bearerAuth: [] }],
  request: { query: paginationQuery },
  responses: {
    200: {
      description: 'Page de projets',
      content: { 'application/json': { schema: pageEnvelope(Project, 'ProjectPage') } },
    },
    401: jsonError('Non authentifié'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/projects',
  summary: 'Créer un projet (admin/superviseur)',
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string().min(1).max(160),
            description: z.string().max(2000).optional(),
            startFrame: z.number().int().optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Projet créé',
      content: { 'application/json': { schema: z.object({ project: Project }) } },
    },
    403: jsonError('Rôle insuffisant'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/projects/{projectId}',
  summary: "Détail d'un projet",
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ projectId: z.coerce.number().int() }) },
  responses: {
    200: {
      description: 'Projet',
      content: { 'application/json': { schema: z.object({ project: Project }) } },
    },
    404: jsonError('Projet introuvable'),
  },
});

/** Produit le document OpenAPI 3.0 (mémoïsé). */
let cached: ReturnType<OpenApiGeneratorV3['generateDocument']> | null = null;
export function buildOpenApiDocument() {
  if (cached) return cached;
  cached = new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: '3.0.0',
    info: {
      title: 'ReView API',
      version: '2.0.0',
      description: 'API de la plateforme de review collaborative ReView (générée depuis les schémas Zod).',
      // Le document est public : il porte la licence de l'API qu'il décrit.
      license: { name: 'AGPL-3.0-or-later', url: 'https://www.gnu.org/licenses/agpl-3.0.html' },
    },
    servers: [{ url: '/' }],
  });
  return cached;
}
