// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from './prisma';
import { publishRedis, subscribeRedis } from './redis';
import type { Role } from '@prisma/client';

/**
 * Cache of the authenticated identity (B3).
 *
 * `authenticate` re-read the user from the database on **every HTTP request**: all routers mount
 * it. An ordinary navigation triggers twenty to forty API calls, as many round trips on the most
 * used table of the instance, for three columns that almost never change.
 *
 * The cache stays **in process memory**, which is what gives it its value, but its **invalidation
 * crosses replicas** (Redis channel). Without this, demoting an account would only have cleared
 * the entry on the replica that handled the write: the others would have kept serving the old
 * role until expiry, that is, up to thirty seconds of rights we thought were withdrawn.
 */

export interface CachedUser {
  id: number;
  email: string;
  role: Role;
  /**
   * Account deactivation date (offboarding), `null` while the account is active.
   *
   * It lives here because a right that is not loaded is a right that cannot be refused: without
   * this column, `middleware/auth` had nothing to test, and a deactivated account kept passing
   * with a fresh token.
   */
  disabledAt: Date | null;
}

const TTL_MS = 30_000;
const CACHE_MAX = 5_000;
const INVALIDATE_CHANNEL = 'review:user-cache';

const cache = new Map<number, { user: CachedUser | null; until: number }>();
let wired = false;

/** Subscription set up on the first read: a process that does not authenticate can do without it. */
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

/** Minimal identity of an account, cached for 30 s. `null` = deleted account. */
export async function getAuthUser(id: number): Promise<CachedUser | null> {
  ensureWiring();
  const hit = cache.get(id);
  if (hit && hit.until > Date.now()) return hit.user;
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, role: true, disabledAt: true },
  });
  cacheSet(id, user);
  return user;
}

/**
 * To call after any write that touches the role, email or existence of an account.
 * Without this forgetting, a demoted account would keep its rights for the duration of the cache,
 * on **all** replicas: hence the notification, not just the local forgetting.
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
