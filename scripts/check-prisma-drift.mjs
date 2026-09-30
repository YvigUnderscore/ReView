// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Dérive entre `schema.prisma` et les migrations.
 *
 * `prisma validate` ne vérifie que la syntaxe du fichier. Une modification de modèle sans
 * `migrate dev` passe donc au vert : le client généré au build connaît la colonne, la base
 * servie par `migrate deploy` en production ne l'a pas, et la panne se découvre à la
 * première requête. Ce contrôle rejoue les migrations sur une base fantôme et compare le
 * schéma obtenu au modèle.
 *
 * **Divergences admises.** Certaines choses ne s'écrivent pas dans `schema.prisma` : un
 * index GIN trigramme, par exemple, ne vit que dans le SQL d'une migration. Prisma les
 * signalerait à chaque exécution. Elles sont donc listées, une par une, dans
 * `scripts/prisma-drift-allowed.json` — et la liste est stricte dans les deux sens : une
 * instruction inattendue échoue, une instruction listée qui n'apparaît plus échoue aussi
 * (l'entrée est devenue mensongère, il faut la retirer).
 *
 * Usage :
 *   node scripts/check-prisma-drift.mjs           # saute proprement sans base joignable
 *   REVIEW_REQUIRE_DRIFT_CHECK=1 node …           # exige la base (CI)
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND = path.join(repoRoot, 'backend');
const ALLOWED_FILE = path.join(repoRoot, 'scripts/prisma-drift-allowed.json');

/** Base fantôme : Prisma y rejoue les migrations puis la vide. Jamais une base de travail. */
export const SHADOW_DATABASE_NAME = 'review_prisma_shadow';

/** Découpe un script SQL en instructions comparables (commentaires et mise en page ôtés). */
export function normalizeStatements(sql) {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, '').trim())
    .join(' ')
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** Compare l'observé à l'attendu. Rend les deux écarts, dans les deux sens. */
export function compareStatements(observed, allowed) {
  const allowedSet = new Set(allowed);
  const observedSet = new Set(observed);
  return {
    unexpected: observed.filter((s) => !allowedSet.has(s)),
    stale: allowed.filter((s) => !observedSet.has(s)),
  };
}

/** Même URL, autre base — l'URL fantôme se dérive de celle de travail. */
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

/** Crée la base fantôme si elle manque. Son absence est le seul cas qui nous intéresse. */
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
    // Existe déjà, ou l'utilisateur n'a pas le droit de créer : `migrate diff` tranchera.
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

/** Repli hors CI : la variable vit dans `backend/.env`, pas dans l'environnement du shell. */
function readDotenvDatabaseUrl() {
  const file = path.join(BACKEND, '.env');
  if (!existsSync(file)) return null;
  const match = /^\s*DATABASE_URL\s*=\s*"?([^"\n\r]+)"?\s*$/m.exec(readFileSync(file, 'utf8'));
  return match ? match[1].trim() : null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
