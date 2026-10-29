// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { adminDatabaseUrl, databaseNameOf, loadItestDatabaseUrl } from './itestEnv';

const run = promisify(execFile);

/**
 * Prepares the integration suite: a fresh database on every run.
 *
 * Two steps, in this order:
 *  1. create the database if it does not exist (a fresh Postgres instance, or a new machine,
 *     only has `review`);
 *  2. `prisma migrate reset --force`: the schema is rebuilt **by the versioned migrations**,
 *     never by a `db push`. A broken migration therefore fails the suite here, instead of being
 *     discovered in production.
 *
 * Intended consequence: no test can depend on what a previous run left behind, and the
 * development database is no longer touched at all.
 */

/** Setup log. `console` is banned in `src/`, and pino is not loaded here. */
function say(message: string): void {
  process.stdout.write(`${message}\n`);
}

/**
 * The Prisma CLI is launched through its JavaScript file, not through `npx`.
 *
 * On Windows `npx` is a `.cmd` file, which Node refuses to launch without `shell: true` since the
 * CVE-2024-27980 fix; and `shell: true` concatenates arguments without escaping them, while one of
 * them is a connection URL. Naming the script avoids both problems and also skips resolving `npx`.
 */
const prismaCli = join(
  dirname(createRequire(join(process.cwd(), 'package.json')).resolve('prisma/package.json')),
  'build/index.js',
);

const prisma = (args: string[], env: NodeJS.ProcessEnv = {}) =>
  run(process.execPath, [prismaCli, ...args], {
    env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: '1', ...env },
    maxBuffer: 8 * 1024 * 1024,
  });

/** Creates the database if missing. Its existence is the common case: failure here is then expected. */
async function createDatabaseIfMissing(url: string, name: string): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'review-itest-'));
  const file = join(dir, 'create-database.sql');
  try {
    await writeFile(file, `CREATE DATABASE "${name}";`, 'utf8');
    await prisma(['db', 'execute', '--url', adminDatabaseUrl(url), '--file', file]);
    say(`  base « ${name} » créée`);
  } catch {
    // Already present: a real connection failure will be reported by `migrate reset`.
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export default async function setup(): Promise<void> {
  const url = loadItestDatabaseUrl();
  const name = databaseNameOf(url);
  say(`\x1b[1;36m▶ Intégration — base jetable « ${name} »\x1b[0m`);

  await createDatabaseIfMissing(url, name);
  await prisma(['migrate', 'reset', '--force', '--skip-generate', '--skip-seed'], {
    DATABASE_URL: url,
  });
  say('  migrations appliquées, base vide\n');
}
