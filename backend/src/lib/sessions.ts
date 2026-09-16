// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomBytes } from 'node:crypto';
import type { Request } from 'express';
import { prisma } from './prisma';
import { publishRedis } from './redis';
import { env } from '../config/env';

/**
 * Sessions de connexion révocables (36.B). Un login = une ligne `UserSession` dont l'id
 * (sid) est embarqué dans les JWT access + refresh : révoquer la session invalide les
 * deux. Le middleware vérifie la validité avec un petit cache in-process (TTL 30 s) —
 * la révocation est effective en ≤ 30 s sans requête DB par appel.
 */

/**
 * Canal de révocation immédiate (A3-02, volet immédiat).
 *
 * Deux trous se refermaient mal avec le seul cache local :
 *
 *  1. le cache de validité est **par process** — la réplique qui a servi le `DELETE /sessions`
 *     invalide le sien, les autres continuent de répondre « session vivante » pendant trente
 *     secondes ;
 *  2. une websocket vit des jours. `SocketService` rejoue bien les contrôles, mais toutes les
 *     minutes : une minute pendant laquelle l'onglet du partant recevait encore les
 *     commentaires internes du projet et les URL présignées de leurs pièces jointes.
 *
 * La révocation publie donc les `sid` concernés ; chaque réplique tombe son cache et ferme
 * les sockets correspondants sans attendre son balayage. La publication est best-effort
 * (`publishRedis` avale les pannes) : c'est assumé, le balayage périodique reste le filet.
 */
export const SESSION_REVOCATION_CHANNEL = 'review:session-revoked';

/** Charge utile du canal : la liste des `sid` révoqués, rien de plus (aucune donnée de compte). */
export const encodeSessionRevocation = (sids: readonly string[]): string => JSON.stringify({ sids });

/**
 * Décodage défensif : le canal est partagé et rien ne garantit ce qu'on y lit. Un message
 * illisible rend une liste vide plutôt qu'une exception — un abonné pub/sub qui jette tue
 * le gestionnaire, pas seulement le message.
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
 * Applique localement une révocation venue d'une autre réplique : le cache de validité doit
 * tomber TOUT DE SUITE, sinon `isSessionActive` continuerait de répondre « vivante » jusqu'à
 * trente secondes et la déconnexion du socket serait cosmétique (l'API, elle, accepterait
 * encore le jeton).
 */
export function markSessionsRevoked(sids: readonly string[]): void {
  for (const sid of sids) cacheSet(sid, false);
}

/** Publie une révocation. Une liste vide ne réveille personne. */
function publishRevocation(sids: readonly string[]): void {
  if (sids.length === 0) return;
  publishRedis(SESSION_REVOCATION_CHANNEL, encodeSessionRevocation(sids));
}

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
  if (r.count > 0) {
    cacheSet(sid, false);
    // Les autres répliques ne savent rien de cette écriture : elles tiennent leur propre
    // cache, et c'est l'une d'elles qui héberge peut-être la websocket de ce `sid`.
    publishRevocation([sid]);
  }
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
  const sids = sessions.map((s) => s.id);
  markSessionsRevoked(sids);
  // Publier depuis ici plutôt que depuis `revokeAllCredentials` : tous les chemins de
  // révocation en masse (offboarding, changement de mot de passe, réinitialisation admin)
  // passent par cette fonction, et `keepSessionId` est déjà exclu du `where` — la session
  // de l'auteur de l'action n'est donc jamais dans la liste publiée.
  publishRevocation(sids);
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
