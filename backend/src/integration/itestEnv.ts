// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { config as loadDotenv } from 'dotenv';

/**
 * Base de données de la suite d'intégration.
 *
 * La suite tournait sur la base de développement, qu'aucune étape ne réinitialisait : elle
 * y laissait un utilisateur par exécution, dépendait de ce que les exécutions précédentes y
 * avaient déposé, et n'était donc ni rejouable ni portable en CI. Elle a maintenant sa
 * propre base, remise à neuf avant chaque passage (`globalSetup`).
 *
 * Le nom est **imposé** : toute URL dont la base ne se termine pas par `_itest` est refusée.
 * C'est le seul garde-fou qui empêche un `DATABASE_URL` mal placé de faire tomber
 * `migrate reset --force` sur une base de travail — l'erreur ne se rattrape pas.
 */

/** Nom par défaut de la base réservée aux tests d'intégration. */
export const ITEST_DATABASE_NAME = 'review_itest';

/** Suffixe exigé de toute base d'intégration : le contrat qui protège la base de travail. */
export const ITEST_DATABASE_SUFFIX = '_itest';

/** Nom de la base porté par une URL Postgres (premier segment du chemin). */
export function databaseNameOf(url: string): string {
  return new URL(url).pathname.replace(/^\//, '');
}

/** Même URL, autre base — les paramètres (`?schema=public`) sont conservés. */
export function withDatabaseName(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

/**
 * URL de la base d'intégration, dérivée de l'environnement.
 *
 * - `ITEST_DATABASE_URL` est prioritaire (CI, base distante) ;
 * - sinon `DATABASE_URL` est reprise, sa base remplacée par `review_itest`.
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

/** URL de maintenance (base `postgres`) : la seule d'où l'on peut créer la base d'intégration. */
export function adminDatabaseUrl(itestUrl: string): string {
  return withDatabaseName(itestUrl, 'postgres');
}

/**
 * Charge `backend/.env` puis résout l'URL d'intégration.
 *
 * Appelée depuis `vitest.integration.config.ts` et depuis `globalSetup`, qui s'exécutent
 * tous deux hors du processus de test : ni l'un ni l'autre n'a chargé `config/env.ts`.
 */
export function loadItestDatabaseUrl(): string {
  loadDotenv();
  return resolveItestDatabaseUrl(process.env);
}
