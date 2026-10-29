// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash, randomBytes } from 'node:crypto';
import { generate, generateSecret, generateURI, verify } from 'otplib';
import { getRedis } from './redis';
import { logger } from './logger';

/**
 * 2FA TOTP (36.A): helpers (tested) built on top of otplib v13 (functional, async API).
 * The secret is stored encrypted (lib/crypto) in User.totpSecret; backup codes are stored
 * hashed (sha256) and consumed one at a time.
 */

export const generateTotpSecret = (): string => generateSecret();

/** `otpauth://` URI for the QR code (rendered client-side). */
export const otpauthUri = (email: string, issuer: string, secret: string): string =>
  generateURI({ secret, issuer, label: email });

/** Current TOTP code (tests / tooling). */
export const currentTotp = (secret: string): Promise<string> => generate({ secret });

/** Verifies a TOTP code (window handled by otplib). */
export async function verifyTotp(secret: string, code: string): Promise<boolean> {
  try {
    const r = await verify({ secret, token: code.replace(/\s/g, '') });
    return r.valid === true;
  } catch {
    return false;
  }
}

/**
 * Normalizes an entered code: case, spaces and readability separators are ignored.
 * Backup codes issued before the switch to 128 bits had no separators, so their hash is
 * unchanged and they keep working.
 */
const normalizeCode = (code: string): string =>
  code
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

// ── TOTP code replay protection ──────────────────────────────────────────────────

/**
 * A TOTP code stays valid for its whole time step (30 s, plus otplib's tolerance). Without a
 * memory of the codes already presented, the one that is intercepted (shoulder surfing,
 * real-time phishing, a misconfigured client's log) can be replayed as long as the window has
 * not passed: the second factor then proves nothing.
 *
 * Two layers, which do not play the same role:
 *
 *  - `consumeTotpOnce`: LOCAL guard inside the process. Free, it short-circuits a replay already
 *    seen by THIS replica and catches an eviction of the shared marker under memory pressure.
 *    It is not enough: it knows nothing of what the other replica serves.
 *  - `consumeTotpOnceShared`: SHARED guard (Redis), **the only one the verification route must
 *    call**. On two replicas behind the same front end, the local guard does not see the attempt
 *    served by the other: the intercepted code is replayed by landing on the second one. The rate
 *    limiter was moved to Redis for exactly this reason (`middleware/rateLimit`); presence and
 *    live rooms too.
 */
const REPLAY_TTL_MS = 120_000;
const REPLAY_MAX_ENTRIES = 50_000;
const usedTotp = new Map<string, number>();

const totpKey = (userId: number, code: string): string => `${userId}:${normalizeCode(code)}`;

/**
 * Records a TOTP code as consumed. Returns `false` if it already was: the caller must then refuse
 * the verification, exactly as for a wrong code.
 */
export function consumeTotpOnce(userId: number, code: string): boolean {
  const now = Date.now();
  // Sweep on insertion: no timer to keep alive, and the table stays bounded.
  for (const [k, until] of usedTotp) {
    if (until <= now) usedTotp.delete(k);
  }
  // Safety ceiling: better to forget (and fall back to the earlier behavior) than
  // to let memory saturation become a denial of service.
  if (usedTotp.size >= REPLAY_MAX_ENTRIES) usedTotp.clear();

  const key = totpKey(userId, code);
  if ((usedTotp.get(key) ?? 0) > now) return false;
  usedTotp.set(key, now + REPLAY_TTL_MS);
  return true;
}

/** Marker shared between replicas. The prefix files it with the other volatile states. */
const totpRedisKey = (userId: number, code: string): string => `totp:used:${totpKey(userId, code)}`;

/**
 * Consumption of a TOTP code valid for the WHOLE instance, replicas included.
 *
 * `SET … PX … NX` is atomic: the first replica sets the key and receives `OK`, the second
 * receives `null` and refuses. The local guard is still consulted first: it is free and avoids
 * a round trip on a replay this replica has already seen.
 *
 * ⚠ **FAIL CLOSED if Redis does not answer.** An anti-replay store that lost the memory of what
 * was presented cannot answer "never seen": letting it through would make the marker's outage the
 * way to bypass it. This is word for word the rule already upheld by the rate limiter
 * (`middleware/rateLimit`, fail closed with a 429). And this closure costs no availability that
 * 2FA would still have: `/api/auth/2fa/verify` is preceded by two limiters that are themselves
 * backed by Redis, which refuse the request before it gets here when the server is unreachable.
 *
 * Accepted side effect: the code presented during the outage is burned by the local guard. It is
 * valid for thirty seconds, and the user reads another one.
 */
export async function consumeTotpOnceShared(userId: number, code: string): Promise<boolean> {
  if (!consumeTotpOnce(userId, code)) return false;
  try {
    const reply = await getRedis().call('SET', totpRedisKey(userId, code), '1', 'PX', REPLAY_TTL_MS, 'NX');
    return reply === 'OK';
  } catch (err) {
    logger.error({ err, userId }, '[2fa] anti-rejeu partagé injoignable — code refusé (échec fermé)');
    return false;
  }
}

// ── Backup codes ─────────────────────────────────────────────────────────

export const hashBackupCode = (code: string): string =>
  createHash('sha256').update(normalizeCode(code)).digest('hex');

/**
 * 10 backup codes, **128 bits** each, grouped in blocks of 8 characters for transcription.
 *
 * Hashes are stored without salt or stretching: this is bearable only because the code is long
 * enough to put an exhaustive search out of reach. The previous 40 bits (`randomBytes(5)`) could
 * be enumerated on a GPU if the database leaked, hence the rule: do not shorten these codes to
 * make them more convenient.
 */
export function generateBackupCodes(): { plain: string[]; hashes: string[] } {
  const plain = Array.from({ length: 10 }, () =>
    (randomBytes(16).toString('hex').match(/.{8}/g) ?? []).join('-'),
  );
  return { plain, hashes: plain.map(hashBackupCode) };
}

/** Consumes a backup code: returns the list of remaining hashes, or null if invalid. */
export function consumeBackupCode(hashes: string[], code: string): string[] | null {
  const h = hashBackupCode(code);
  if (!hashes.includes(h)) return null;
  return hashes.filter((x) => x !== h);
}

export const __testing = { usedTotp };
