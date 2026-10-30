// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Drift between `schema.prisma` and the migrations.
 *
 * `prisma validate` only checks the file's syntax. A model change without `migrate dev` therefore
 * passes green: the client generated at build time knows the column, the database served by
 * `migrate deploy` in production does not, and the breakage is only discovered on the first request.
 * This check replays the migrations on a shadow database and compares the resulting schema with the
 * model.
 *
 * **Accepted divergences.** Some things cannot be written in `schema.prisma`: a trigram GIN index,
 * for example, only lives in the SQL of a migration. Prisma would flag them on every run. They are
 * therefore listed, one by one, in `scripts/prisma-drift-allowed.json` — and the list is strict in both
 * directions: an unexpected statement fails, and a listed statement that no longer appears also fails
 * (the entry has become misleading and must be removed).
 *
 * Usage:
 *   node scripts/check-prisma-drift.mjs           # skips cleanly without a reachable database
 *   REVIEW_REQUIRE_DRIFT_CHECK=1 node …           # requires the database (CI)
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND = path.join(repoRoot, 'backend');
const ALLOWED_FILE = path.join(repoRoot, 'scripts/prisma-drift-allowed.json');

/** Shadow database: Prisma replays the migrations there, then empties it. Never a working database. */
export const SHADOW_DATABASE_NAME = 'review_prisma_shadow';

/** Splits an SQL script into comparable statements (comments and layout removed). */
export function normalizeStatements(sql) {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, '').trim())
    .join(' ')
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** Compares the observed with the expected. Returns both gaps, in both directions. */
export function compareStatements(observed, allowed) {
  const allowedSet = new Set(allowed);
  const observedSet = new Set(observed);
  return {
    unexpected: observed.filter((s) => !allowedSet.has(s)),
    stale: allowed.filter((s) => !observedSet.has(s)),
  };
}

/** Same URL, different database — the shadow URL is derived from the working one. */
export function shadowUrlFrom(databaseUrl, name = SHADOW_DATABASE_NAME) {
  const url = new URL(databaseUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

function prisma(args, env = {}) {
  return execFileSync('node', [path.join(BACKEND, 'node_modules/prisma/build/index.js'), ...args], {
    cwd: BACKEND,
    encoding: 'utf8',
    env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  });
}

/** Creates the shadow database if it is missing. Its absence is the only case we care about. */
function ensureShadowDatabase(shadowUrl) {
  const admin = new URL(shadowUrl);
  const name = admin.pathname.replace(/^\//, '');
  admin.pathname = '/postgres';
  const dir = mkdtempSync(path.join(tmpdir(), 'review-shadow-'));
  const file = path.join(dir, 'create.sql');
  try {
    writeFileSync(file, `CREATE DATABASE "${name}";`, 'utf8');
    prisma(['db', 'execute', '--url', admin.toString(), '--file', file]);
  } catch {
    // Already exists, or the user is not allowed to create it: `migrate diff` will settle it.
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return name;
}

function fail(message, hint) {
  console.error(`\x1b[0;31m✗ ${message}\x1b[0m`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
}

function main() {
  const databaseUrl = process.env.DATABASE_URL ?? readDotenvDatabaseUrl();
  const required = process.env.REVIEW_REQUIRE_DRIFT_CHECK === '1';

  if (!databaseUrl) {
    if (required) fail('DATABASE_URL absente : impossible de contrôler la dérive du schéma.');
    console.log('\x1b[0;33m⏭  Dérive schéma/migrations : pas de DATABASE_URL, contrôle sauté.\x1b[0m');
    return;
  }

  const shadowUrl = shadowUrlFrom(databaseUrl);
  ensureShadowDatabase(shadowUrl);

  let script;
  try {
    script = prisma([
      'migrate',
      'diff',
      '--from-migrations',
      'prisma/migrations',
      '--to-schema-datamodel',
      'prisma/schema.prisma',
      '--shadow-database-url',
      shadowUrl,
      '--script',
    ]);
  } catch (err) {
    const detail = `${err.stderr ?? ''}${err.stdout ?? ''}`.trim();
    if (required) fail('Contrôle de dérive impossible.', detail);
    console.log('\x1b[0;33m⏭  Dérive schéma/migrations : base fantôme injoignable, contrôle sauté.\x1b[0m');
    console.log(`  ${detail.split('\n').slice(-3).join(' ')}`);
    return;
  }

  const observed = normalizeStatements(script);
  const allowed = JSON.parse(readFileSync(ALLOWED_FILE, 'utf8')).allowed.map((e) => e.statement);
  const { unexpected, stale } = compareStatements(observed, allowed);

  if (unexpected.length > 0) {
    console.error('\x1b[0;31m✗ schema.prisma et les migrations ont divergé :\x1b[0m');
    for (const s of unexpected) console.error(`    ${s}`);
    console.error(
      '  → une modification de modèle attend son `npx prisma migrate dev`, sinon la base de\n' +
        `    production servie par « migrate deploy » ne contiendra pas ce que le client attend.\n` +
        `    Divergence assumée (SQL non exprimable en Prisma) : la déclarer dans ${path.relative(repoRoot, ALLOWED_FILE)}.`,
    );
    process.exit(1);
  }
  if (stale.length > 0) {
    console.error('\x1b[0;31m✗ Divergences déclarées qui ne se produisent plus :\x1b[0m');
    for (const s of stale) console.error(`    ${s}`);
    console.error(`  → retirer ces entrées de ${path.relative(repoRoot, ALLOWED_FILE)}.`);
    process.exit(1);
  }

  const suffix = allowed.length > 0 ? ` (${allowed.length} divergence(s) déclarée(s))` : '';
  console.log(`\x1b[0;32m✓ schema.prisma et les migrations décrivent la même base${suffix}\x1b[0m`);
}

/** Fallback outside CI: the variable lives in `backend/.env`, not in the shell environment. */
function readDotenvDatabaseUrl() {
  const file = path.join(BACKEND, '.env');
  if (!existsSync(file)) return null;
  const match = /^\s*DATABASE_URL\s*=\s*"?([^"\n\r]+)"?\s*$/m.exec(readFileSync(file, 'utf8'));
  return match ? match[1].trim() : null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
