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
 * Préparation de la suite d'intégration : une base neuve, à chaque exécution.
 *
 * Deux étapes, dans cet ordre :
 *  1. créer la base si elle n'existe pas (une instance Postgres fraîche, ou un poste neuf,
 *     n'a que `review`) ;
 *  2. `prisma migrate reset --force` : le schéma est reconstruit **par les migrations
 *     versionnées**, jamais par un `db push`. Une migration cassée fait donc échouer la
 *     suite ici, au lieu de se découvrir en production.
 *
 * Conséquence voulue : plus aucun test ne peut dépendre de ce qu'un passage précédent a
 * laissé derrière lui, et la base de développement n'est plus touchée du tout.
 */

/** Journal du setup — `console` est proscrit dans `src/`, et pino n'est pas chargé ici. */
function say(message: string): void {
  process.stdout.write(`${message}\n`);
}

/**
 * Le CLI Prisma est lancé par son fichier JavaScript, pas par `npx`.
 *
 * Sous Windows `npx` est un `.cmd`, que Node refuse de lancer sans `shell: true` depuis la
 * correction de CVE-2024-27980 ; et `shell: true` concatène les arguments sans les échapper,
 * or l'un d'eux est une URL de connexion. Nommer le script contourne les deux problèmes et
 * évite au passage la résolution de `npx`.
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

/** Crée la base si elle manque. Son existence est le cas courant : l'échec est alors normal. */
async function createDatabaseIfMissing(url: string, name: string): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'review-itest-'));
  const file = join(dir, 'create-database.sql');
  try {
    await writeFile(file, `CREATE DATABASE "${name}";`, 'utf8');
    await prisma(['db', 'execute', '--url', adminDatabaseUrl(url), '--file', file]);
    say(`  base « ${name} » créée`);
  } catch {
    // Déjà présente — une vraie panne de connexion sera relevée par `migrate reset`.
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
