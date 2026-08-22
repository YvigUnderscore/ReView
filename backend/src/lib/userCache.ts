// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from './prisma';
import { publishRedis, subscribeRedis } from './redis';
import type { Role } from '@prisma/client';

/**
 * Cache de l'identité authentifiée (B3).
 *
 * `authenticate` relisait l'utilisateur en base à **chaque requête HTTP** — tous les
 * routeurs le montent. Une navigation ordinaire déclenche vingt à quarante appels d'API :
 * autant d'allers-retours sur la table la plus sollicitée de l'instance, pour trois
 * colonnes qui ne changent presque jamais.
 *
 * Le cache reste **en mémoire de process** — c'est ce qui lui donne son intérêt — mais son
 * **invalidation traverse les répliques** (canal Redis). Sans cela, rétrograder un compte
 * n'aurait effacé l'entrée que sur la réplique qui a traité l'écriture : les autres
 * auraient continué à servir l'ancien rôle jusqu'à l'expiration, c'est-à-dire jusqu'à
 * trente secondes de droits qu'on croyait retirés.
 */

export interface CachedUser {
  id: number;
  email: string;
  role: Role;
}

const TTL_MS = 30_000;
const CACHE_MAX = 5_000;
const INVALIDATE_CHANNEL = 'review:user-cache';

const cache = new Map<number, { user: CachedUser | null; until: number }>();
let wired = false;

/** Souscription posée à la première lecture : un process qui n'authentifie pas s'en passe. */
function ensureWiring(): void {
  if (wired) return;
  wired = true;
  subscribeRedis(INVALIDATE_CHANNEL, (raw) => {
    const id = Number(raw);
    if (Number.isInteger(id)) cache.delete(id);
  });
}

function cacheSet(id: number, user: CachedUser | null): void {
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(id, { user, until: Date.now() + TTL_MS });
}

/** Identité minimale d'un compte, mise en cache 30 s. `null` = compte supprimé. */
export async function getAuthUser(id: number): Promise<CachedUser | null> {
  ensureWiring();
  const hit = cache.get(id);
  if (hit && hit.until > Date.now()) return hit.user;
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, role: true },
  });
  cacheSet(id, user);
  return user;
}

/**
 * À appeler après toute écriture qui touche le rôle, l'adresse ou l'existence d'un compte.
 * Sans cet oubli-là, un compte rétrogradé garderait ses droits pendant la durée du cache —
 * sur **toutes** les répliques, d'où la notification et pas seulement l'oubli local.
 */
export function invalidateAuthUser(id: number): void {
  cache.delete(id);
  publishRedis(INVALIDATE_CHANNEL, String(id));
}

export const __testing = {
  cache,
  cacheSet,
  TTL_MS,
  INVALIDATE_CHANNEL,
  reset: (): void => {
    wired = false;
  },
};
