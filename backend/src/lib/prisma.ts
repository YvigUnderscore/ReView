// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { PrismaClient } from '@prisma/client';

/**
 * Bornes du pool, posées ici faute de l'être dans l'URL.
 *
 * Sans `connection_limit`, Prisma dimensionne son pool à `cœurs physiques × 2 + 1`, PAR
 * PROCESS. Deux process se connectent (API et worker) et PostgreSQL est laissé à son
 * défaut d'image, `max_connections = 100` : sur un hôte à 32 cœurs physiques — une machine
 * banale pour un serveur de transcodage — cela demande 2 × 65 = 130 connexions pour 100
 * disponibles. Le second process à démarrer prend « FATAL: sorry, too many clients
 * already », et `restart: always` le relance en boucle. La borne ne doit donc pas suivre
 * le matériel.
 *
 * Dix connexions couvrent largement la charge du produit (requêtes courtes), et laissent
 * la place aux sauvegardes, aux migrations et à une seconde réplique.
 */
const DEFAULT_CONNECTION_LIMIT = 10;

/** Attente maximale (secondes) d'une connexion libre avant de rendre une erreur claire. */
const DEFAULT_POOL_TIMEOUT_S = 20;

/**
 * Garde-fou d'exécution côté serveur, en millisecondes.
 *
 * Sans lui, une agrégation partie de travers (vues de production, Gantt) tient sa
 * connexion indéfiniment : la seule sortie est un `pg_terminate_backend` manuel.
 *
 * ⚠ Posé sur la CONNEXION de l'application, et non sur le rôle par migration : un
 * `ALTER ROLE … SET statement_timeout` s'appliquerait aussi aux sessions du CLI Prisma,
 * donc à `prisma migrate deploy` — un index créé sur une grosse table ferait alors échouer
 * la migration au bout d'une minute, au démarrage du conteneur. Le CLI n'instancie pas ce
 * module : il garde le `DATABASE_URL` brut, sans délai.
 */
const DEFAULT_STATEMENT_TIMEOUT_MS = 60_000;

/** Entier strictement positif lu dans l'environnement, sinon le repli. */
function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/**
 * Début de la query d'une URL de connexion.
 *
 * On cherche le « ? » APRÈS le dernier « @ » : un mot de passe mal encodé qui en contient
 * un ne doit pas faire passer la moitié des identifiants pour des paramètres.
 */
function queryStart(url: string): number {
  return url.indexOf('?', url.lastIndexOf('@') + 1);
}

/** Le paramètre est-il DÉJÀ présent ? Un choix explicite de l'exploitant prime. */
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
 * Complète une URL de connexion des bornes qui lui manquent.
 *
 * Filet et non doublon : `docker-compose.yml` pose déjà `connection_limit` et
 * `pool_timeout` dans les deux `DATABASE_URL` qu'il construit, pour que la borne soit
 * lisible là où un exploitant la cherche. Cette fonction couvre tous les AUTRES chemins
 * d'exécution — un `.env` écrit à la main, une pile qui n'est pas celle du dépôt, un
 * script lancé depuis l'hôte — et ne touche jamais à ce qui est déjà écrit.
 *
 * Rend `undefined` quand il n'y a rien à surcharger : le client retombe alors sur le
 * `DATABASE_URL` du schéma Prisma, comme avant.
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
    // Encodage explicite (%20, %3D) plutôt que via URLSearchParams, qui écrirait l'espace
    // en « + » : le serveur découpe `options` sur les espaces, un « + » littéral ferait un
    // jeton inconnu et la connexion échouerait.
    const ms = positiveInt(env.DB_STATEMENT_TIMEOUT_MS, DEFAULT_STATEMENT_TIMEOUT_MS);
    // Concaténation et non gabarit : `check-untranslated` compte les fragments de gabarit,
    // et ce paramètre d'URL n'est pas un texte d'interface.
    url = appendParam(url, 'options=-c%20statement_timeout%3D' + String(ms));
  }
  return url === rawUrl ? undefined : url;
}

/**
 * Singleton PrismaClient — réutilisé entre les hot-reloads en dev pour éviter
 * d'épuiser le pool de connexions.
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
