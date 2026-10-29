// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomBytes } from 'node:crypto';
import type { Request } from 'express';
import { prisma } from './prisma';
import { publishRedis } from './redis';
import { env } from '../config/env';
import { ignoreFailure } from './ignoreFailure';

/**
 * Revocable login sessions (36.B). One login = one `UserSession` row whose id (sid) is embedded in the access and refresh JWTs: revoking the session
 * invalidates both. The middleware checks validity with a small in-process cache (TTL 30 s) — revocation takes effect within ≤ 30 s without a DB query per call.
 */

/**
 * Immediate revocation channel (A3-02, immediate part).
 *
 * Two gaps were poorly closed by the local cache alone:
 *
 *  1. the validity cache is **per process** — the replica that served the `DELETE /sessions` invalidates its own, the others keep answering "session alive" for thirty seconds;
 *  2. a websocket lives for days. `SocketService` does replay the checks, but only every minute: a minute during which the departing user's tab still received the project's internal comments and the presigned URLs of their attachments.
 *
 * Revocation therefore publishes the affected `sid`s; each replica drops its cache and closes the matching sockets without waiting for its sweep. Publication is best-effort
 * (`publishRedis` swallows outages): this is deliberate, the periodic sweep remains the safety net.
 */
export const SESSION_REVOCATION_CHANNEL = 'review:session-revoked';

/** Channel payload: the list of revoked `sid`s, nothing more (no account data). */
export const encodeSessionRevocation = (sids: readonly string[]): string => JSON.stringify({ sids });

/**
 * Defensive decoding: the channel is shared and nothing guarantees what is read from it. An unreadable message yields an empty list rather than an exception —
 * a pub/sub subscriber that throws kills the handler, not just the message.
 */
export function decodeSessionRevocation(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as { sids?: unknown };
    if (!Array.isArray(parsed?.sids)) return [];
    return parsed.sids.filter((s): s is string => typeof s === 'string' && s.length > 0);
  } catch {
    return [];
  }
}

/**
 * Locally applies a revocation coming from another replica: the validity cache must drop RIGHT AWAY, otherwise `isSessionActive` would keep answering
 * "alive" for up to thirty seconds and the socket disconnection would be cosmetic (the API would still accept the token).
 */
export function markSessionsRevoked(sids: readonly string[]): void {
  for (const sid of sids) cacheSet(sid, false);
}

/** Publishes a revocation. An empty list wakes no one. */
function publishRevocation(sids: readonly string[]): void {
  if (sids.length === 0) return;
  publishRedis(SESSION_REVOCATION_CHANNEL, encodeSessionRevocation(sids));
}

const CACHE_TTL_MS = 30_000;
const CACHE_MAX = 10_000;

/** `30d` / `12h` / `15m` / `45s` → milliseconds (fallback if the format is unknown). */
export function parseDurationMs(input: string, fallbackMs: number): number {
  const m = /^(\d+)([smhd])$/.exec(input.trim());
  if (!m) return fallbackMs;
  const n = Number(m[1]);
  const unit = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as 's' | 'm' | 'h' | 'd'];
  return n * unit;
}

const sessionLifetimeMs = () => parseDurationMs(env.JWT_REFRESH_EXPIRES_IN, 30 * 86_400_000);

/** Creates a session for a successful login and returns its sid. */
export async function createSession(userId: number, req: Request): Promise<string> {
  const sid = randomBytes(16).toString('hex');
  await prisma.userSession.create({
    data: {
      id: sid,
      userId,
      userAgent: (req.headers['user-agent'] ?? '').toString().slice(0, 255) || null,
      ip: req.ip ?? null,
      expiresAt: new Date(Date.now() + sessionLifetimeMs()),
    },
  });
  return sid;
}

/** Extends activity (successful refresh): lastSeenAt + sliding expiry. */
export async function touchSession(sid: string): Promise<void> {
  await prisma.userSession
    .update({
      where: { id: sid },
      data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + sessionLifetimeMs()) },
    })
    .catch(ignoreFailure('session touch failed', { sessionId: sid }));
}

/** Live sessions of an account, most recently seen first (account security screen). */
export function listActiveSessions(userId: number) {
  return prisma.userSession.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: 'desc' },
    select: { id: true, userAgent: true, ip: true, createdAt: true, lastSeenAt: true },
  });
}

/** Revokes a session (bounded to `userId` if supplied). Returns true if found. */
export async function revokeSession(sid: string, userId?: number): Promise<boolean> {
  const r = await prisma.userSession.updateMany({
    where: { id: sid, revokedAt: null, ...(userId != null ? { userId } : {}) },
    data: { revokedAt: new Date() },
  });
  if (r.count > 0) {
    cacheSet(sid, false);
    // The other replicas know nothing of this write: they keep their own cache, and one of them may be hosting this `sid`'s websocket.
    publishRevocation([sid]);
  }
  return r.count > 0;
}

/**
 * Revokes all the sessions of an account (admin offboarding, password change). `keepSessionId` spares one session — that of the author of the action,
 * who should not be logged out for having secured their own account.
 */
export async function revokeAllCredentials(userId: number, keepSessionId?: string): Promise<void> {
  // A session is not the only identifier of the account: an API token `rvk_` authenticates just as well, through a fully separate table. Revoking only the
  // sessions would let a token the attacker created survive — taking the account back in hand (password change, reset by an admin) would then be illusory.
  await Promise.all([
    revokeAllSessions(userId, keepSessionId),
    prisma.apiToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
}

export async function revokeAllSessions(userId: number, keepSessionId?: string): Promise<number> {
  const where = {
    userId,
    revokedAt: null,
    ...(keepSessionId ? { id: { not: keepSessionId } } : {}),
  };
  const sessions = await prisma.userSession.findMany({ where, select: { id: true } });
  const r = await prisma.userSession.updateMany({ where, data: { revokedAt: new Date() } });
  const sids = sessions.map((s) => s.id);
  markSessionsRevoked(sids);
  // Publishing from here rather than from `revokeAllCredentials`: every mass-revocation path (offboarding, password change, admin reset) goes through this
  // function, and `keepSessionId` is already excluded from the `where` — the author's session is therefore never in the published list.
  publishRevocation(sids);
  return r.count;
}

// ── Validity cache (in-process, single instance like the rate limiter) ──
const cache = new Map<string, { ok: boolean; until: number }>();

function cacheSet(sid: string, ok: boolean): void {
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(sid, { ok, until: Date.now() + CACHE_TTL_MS });
}

/** Existing session, not revoked, not expired? (result cached for 30 s) */
export async function isSessionActive(sid: string): Promise<boolean> {
  const hit = cache.get(sid);
  if (hit && hit.until > Date.now()) return hit.ok;
  const s = await prisma.userSession.findUnique({
    where: { id: sid },
    select: { revokedAt: true, expiresAt: true },
  });
  const ok = !!s && !s.revokedAt && s.expiresAt > new Date();
  cacheSet(sid, ok);
  return ok;
}

export const __testing = { cache, cacheSet };
