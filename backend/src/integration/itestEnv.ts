// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { config as loadDotenv } from 'dotenv';

/**
 * Database of the integration suite.
 *
 * The suite used to run against the development database, which no step reset: it left one user
 * per run, depended on what earlier runs had left there, and was therefore neither repeatable nor
 * portable to CI. It now has its own database, reset before each run (`globalSetup`).
 *
 * The name is **enforced**: any URL whose database name does not end in `_itest` is refused.
 * It is the only guard preventing a misplaced `DATABASE_URL` from running
 * `migrate reset --force` on a working database, an error that cannot be undone.
 */

/** Default name of the database reserved for integration tests. */
export const ITEST_DATABASE_NAME = 'review_itest';

/** Suffix required of every integration database: the contract that protects the working database. */
export const ITEST_DATABASE_SUFFIX = '_itest';

/** Database name carried by a Postgres URL (first segment of the path). */
export function databaseNameOf(url: string): string {
  return new URL(url).pathname.replace(/^\//, '');
}

/** Same URL, different database: query parameters (`?schema=public`) are kept. */
export function withDatabaseName(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

/**
 * URL of the integration database, derived from the environment.
 *
 * - `ITEST_DATABASE_URL` takes precedence (CI, remote database);
 * - otherwise `DATABASE_URL` is reused, with its database replaced by `review_itest`.
 */
export function resolveItestDatabaseUrl(source: NodeJS.ProcessEnv): string {
  const explicit = source.ITEST_DATABASE_URL?.trim();
  const base = source.DATABASE_URL?.trim();
  const raw = explicit || base;
  if (!raw) {
    throw new Error(
      'Integration tests need DATABASE_URL (or ITEST_DATABASE_URL) to derive the throwaway database.',
    );
  }

  const resolved = explicit ? explicit : withDatabaseName(raw, ITEST_DATABASE_NAME);
  const name = databaseNameOf(resolved);
  if (!name.endsWith(ITEST_DATABASE_SUFFIX)) {
    throw new Error(
      `Refusing to run integration tests against database "${name}": the name must end with ` +
        `"${ITEST_DATABASE_SUFFIX}" (the suite resets it with prisma migrate reset --force).`,
    );
  }
  return resolved;
}

/** Maintenance URL (`postgres` database): the only one from which the integration database can be created. */
export function adminDatabaseUrl(itestUrl: string): string {
  return withDatabaseName(itestUrl, 'postgres');
}

/**
 * Loads `backend/.env`, then resolves the integration URL.
 *
 * Called from `vitest.integration.config.ts` and from `globalSetup`, both of which run outside
 * the test process: neither has loaded `config/env.ts`.
 */
export function loadItestDatabaseUrl(): string {
  loadDotenv();
  return resolveItestDatabaseUrl(process.env);
}
