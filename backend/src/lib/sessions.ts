// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomBytes } from 'node:crypto';
import type { Request } from 'express';
import { prisma } from './prisma';
import { env } from '../config/env';

/**
 * Sessions de connexion révocables (36.B). Un login = une ligne `UserSession` dont l'id
 * (sid) est embarqué dans les JWT access + refresh : révoquer la session invalide les
 * deux. Le middleware vérifie la validité avec un petit cache in-process (TTL 30 s) —
 * la révocation est effective en ≤ 30 s sans requête DB par appel.
 */

const CACHE_TTL_MS = 30_000;
const CACHE_MAX = 10_000;

/** `30d` / `12h` / `15m` / `45s` → millisecondes (repli si format inconnu). */
export function parseDurationMs(input: string, fallbackMs: number): number {
  const m = /^(\d+)([smhd])$/.exec(input.trim());
  if (!m) return fallbackMs;
  const n = Number(m[1]);
  const unit = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as 's' | 'm' | 'h' | 'd'];
  return n * unit;
}

const sessionLifetimeMs = () => parseDurationMs(env.JWT_REFRESH_EXPIRES_IN, 30 * 86_400_000);

/** Crée une session pour un login réussi et renvoie son sid. */
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

/** Prolonge l'activité (refresh réussi) : lastSeenAt + expiration glissante. */
export async function touchSession(sid: string): Promise<void> {
  await prisma.userSession
    .update({
      where: { id: sid },
      data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + sessionLifetimeMs()) },
    })
    .catch(() => undefined);
}

/** Révoque une session (bornée à `userId` si fourni). Renvoie vrai si trouvée. */
export async function revokeSession(sid: string, userId?: number): Promise<boolean> {
  const r = await prisma.userSession.updateMany({
    where: { id: sid, revokedAt: null, ...(userId != null ? { userId } : {}) },
    data: { revokedAt: new Date() },
  });
  if (r.count > 0) cacheSet(sid, false);
  return r.count > 0;
}

/**
 * Révoque toutes les sessions d'un compte (offboarding admin, changement de mot de passe).
 * `keepSessionId` épargne une session — celle de l'auteur de l'action, qui n'a pas à être
 * déconnecté pour avoir sécurisé son propre compte.
 */
export async function revokeAllCredentials(userId: number, keepSessionId?: string): Promise<void> {
  // Une session n'est pas le seul identifiant du compte : un token d'API `rvk_` authentifie
  // tout aussi bien, par une table entièrement séparée. Ne révoquer que les sessions
  // laisserait survivre le jeton qu'un attaquant s'est créé — la reprise en main du compte
  // (changement de mot de passe, réinitialisation par un admin) serait alors illusoire.
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
  for (const s of sessions) cacheSet(s.id, false);
  return r.count;
}

// ── Cache de validité (in-process, mono-instance comme le rate limiter) ───────
const cache = new Map<string, { ok: boolean; until: number }>();

function cacheSet(sid: string, ok: boolean): void {
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(sid, { ok, until: Date.now() + CACHE_TTL_MS });
}

/** Session existante, non révoquée, non expirée ? (résultat mis en cache 30 s) */
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
