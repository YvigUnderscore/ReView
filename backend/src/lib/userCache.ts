// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from './prisma';
import type { Role } from '@prisma/client';

/**
 * Cache de l'identité authentifiée (B3).
 *
 * `authenticate` relisait l'utilisateur en base à **chaque requête HTTP** — tous les
 * routeurs le montent. Une navigation ordinaire déclenche vingt à quarante appels d'API :
 * autant d'allers-retours sur la table la plus sollicitée de l'instance, pour trois
 * colonnes qui ne changent presque jamais.
 *
 * Même parti pris que la validité de session (`lib/sessions.ts`) : un cache in-process de
 * courte durée, mono-instance. Un rôle modifié met donc jusqu'à trente secondes à
 * s'appliquer — sauf aux endroits qui invalident explicitement, ce que font toutes les
 * écritures sur le compte.
 */

export interface CachedUser {
  id: number;
  email: string;
  role: Role;
}

const TTL_MS = 30_000;
const CACHE_MAX = 5_000;

const cache = new Map<number, { user: CachedUser | null; until: number }>();

function cacheSet(id: number, user: CachedUser | null): void {
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(id, { user, until: Date.now() + TTL_MS });
}

/** Identité minimale d'un compte, mise en cache 30 s. `null` = compte supprimé. */
export async function getAuthUser(id: number): Promise<CachedUser | null> {
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
 * Sans cet oubli-là, un compte rétrogradé garderait ses droits pendant la durée du cache.
 */
export function invalidateAuthUser(id: number): void {
  cache.delete(id);
}

export const __testing = { cache, cacheSet, TTL_MS };
