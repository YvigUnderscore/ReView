// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { PrismaClient } from '@prisma/client';

/**
 * Pool bounds, set here since they are not set in the URL.
 *
 * Without `connection_limit`, Prisma sizes its pool at `physical cores × 2 + 1`, PER PROCESS. Two processes connect (API and worker)
 * and PostgreSQL is left at its image default, `max_connections = 100`: on a 32-physical-core host — an ordinary machine for a transcoding
 * server — that asks for 2 × 65 = 130 connections for 100 available. The second process to start gets "FATAL: sorry, too many clients
 * already", and `restart: always` relaunches it in a loop. The bound must therefore not follow the hardware.
 *
 * Ten connections comfortably cover the product's load (short queries), and leave room for backups, migrations and a second replica.
 */
const DEFAULT_CONNECTION_LIMIT = 10;

/** Maximum wait (seconds) for a free connection before returning a clear error. */
const DEFAULT_POOL_TIMEOUT_S = 20;

/**
 * Server-side execution guard, in milliseconds.
 *
 * Without it, an aggregation that went wrong (production views, Gantt) holds its connection indefinitely: the only way out is a
 * manual `pg_terminate_backend`.
 *
 * ⚠ Set on the APPLICATION's CONNECTION, not on the role per migration: an `ALTER ROLE … SET statement_timeout` would also apply
 * to the Prisma CLI sessions, hence to `prisma migrate deploy` — an index built on a large table would then make the migration fail
 * after one minute, at container start-up. The CLI does not instantiate this module: it keeps the raw `DATABASE_URL`, without a delay.
 */
const DEFAULT_STATEMENT_TIMEOUT_MS = 60_000;

/** Strictly positive integer read from the environment, otherwise the fallback. */
function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/**
 * Start of the query of a connection URL.
 *
 * We look for the "?" AFTER the last "@": a badly encoded password containing one must not make half the credentials pass as parameters.
 */
function queryStart(url: string): number {
  return url.indexOf('?', url.lastIndexOf('@') + 1);
}

/** Is the parameter ALREADY present? An explicit choice of the operator takes precedence. */
function hasParam(url: string, name: string): boolean {
  const start = queryStart(url);
  if (start < 0) return false;
  return url
    .slice(start + 1)
    .split('&')
    .some((pair) => pair.split('=', 1)[0] === name);
}

function appendParam(url: string, pair: string): string {
  return `${url}${queryStart(url) < 0 ? '?' : '&'}${pair}`;
}

/**
 * Completes a connection URL with the bounds it lacks.
 *
 * A safety net, not a duplicate: `docker-compose.yml` already sets `connection_limit` and `pool_timeout` in the two `DATABASE_URL`s it
 * builds, so that the bound is readable where an operator looks for it. This function covers all the OTHER execution paths — a
 * hand-written `.env`, a stack that is not the repository's, a script launched from the host — and never touches what is already written.
 *
 * Returns `undefined` when there is nothing to override: the client then falls back on the `DATABASE_URL` of the Prisma schema, as before.
 */
export function withPoolBounds(
  rawUrl: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (!rawUrl || !/^(?:postgres|postgresql):\/\//i.test(rawUrl)) return undefined;

  let url = rawUrl;
  if (!hasParam(url, 'connection_limit')) {
    url = appendParam(url, `connection_limit=${positiveInt(env.DB_POOL, DEFAULT_CONNECTION_LIMIT)}`);
  }
  if (!hasParam(url, 'pool_timeout')) {
    url = appendParam(url, `pool_timeout=${positiveInt(env.DB_POOL_TIMEOUT, DEFAULT_POOL_TIMEOUT_S)}`);
  }
  if (!hasParam(url, 'options')) {
    // Explicit encoding (%20, %3D) rather than via URLSearchParams, which would write the space as "+": the server splits `options` on
    // spaces, and a literal "+" would make an unknown token and the connection would fail.
    const ms = positiveInt(env.DB_STATEMENT_TIMEOUT_MS, DEFAULT_STATEMENT_TIMEOUT_MS);
    // Concatenation rather than a template: `check-untranslated` counts template fragments, and this URL parameter is not interface text.
    url = appendParam(url, 'options=-c%20statement_timeout%3D' + String(ms));
  }
  return url === rawUrl ? undefined : url;
}

/**
 * PrismaClient singleton — reused across hot-reloads in dev to avoid
 * exhausting the connection pool.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const boundedUrl = withPoolBounds(process.env.DATABASE_URL);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    ...(boundedUrl ? { datasourceUrl: boundedUrl } : {}),
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
