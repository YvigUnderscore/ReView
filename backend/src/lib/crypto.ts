// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createCipheriv, createDecipheriv, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';
import { logger } from './logger';

/**
 * Constant-time comparison of two secrets. The strings are first reduced to a SHA-256: `timingSafeEqual`
 * requires buffers of equal length, and hashing also avoids leaking the length of the expected secret
 * through response timing.
 */
export function secretEquals(a: string | undefined | null, b: string | undefined | null): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Symmetric encryption of secrets stored in the database (SMTP password, OIDC client secret, webhook
 * secret, ShotGrid credentials, TOTP secret) — AES-256-GCM.
 * The key (32 bytes) is derived by SHA-256 from `APP_ENCRYPTION_KEY` (or, failing that, `JWT_SECRET`).
 * Output format: `iv.tag.ciphertext.kid` (base64, `kid` in hex).
 */

/**
 * Fingerprint of the key, written IN CLEAR in the envelope.
 *
 * It protects nothing — GCM does that — it diagnoses. Without it, a secret encrypted with another key is
 * indistinguishable from a corrupted secret: both come out as `null`, and the operator cannot tell whether
 * to recover the key or re-enter the value. The case arises from a NORMAL action: `APP_ENCRYPTION_KEY`
 * being optional, the key derives by default from `JWT_SECRET` — rotating the latter after a token leak
 * (the right response to an incident) makes ALL stored secrets silently unreadable at once.
 * 32 bits of fingerprint are enough to say so, and reveal nothing about the key itself.
 */
const KEY_ID_HEX_LENGTH = 8;

/** Log anti-repeat window: a key failure hits every secret read. */
const LOG_THROTTLE_MS = 60_000;

const LOG_UNREADABLE = '[crypto] stored secret unreadable';
const REMEDY_DERIVED =
  'APP_ENCRYPTION_KEY missing: the key derives from JWT_SECRET, which a rotation is enough to break. Setting it explicitly decouples the two; then re-enter the secrets.';
const REMEDY_EXPLICIT =
  'Restore APP_ENCRYPTION_KEY to its previous value, or re-enter the affected secrets (SMTP, OIDC, webhooks, ShotGrid, 2FA).';
const LOG_DERIVED_KEY =
  '[crypto] APP_ENCRYPTION_KEY missing: stored secrets are encrypted with a key derived from JWT_SECRET. Rotating JWT_SECRET will make them all unreadable.';

const keyMaterial = (): string => env.APP_ENCRYPTION_KEY ?? env.JWT_SECRET;

/** True if the encryption key derives from `JWT_SECRET`, because `APP_ENCRYPTION_KEY` is missing. */
export const usesDerivedEncryptionKey = (): boolean => env.APP_ENCRYPTION_KEY === undefined;

function key(): Buffer {
  return createHash('sha256').update(keyMaterial()).digest();
}

const keyId = (k: Buffer): string => createHash('sha256').update(k).digest('hex').slice(0, KEY_ID_HEX_LENGTH);

const lastLogged = new Map<string, number>();
let derivedKeyWarned = false;

/**
 * Records a decryption failure — an ERROR, not silence, and with the action to take.
 *
 * The historic fail-open happened here: every caller replaced the `null` with `''` or `undefined` and
 * carried on (empty HMAC signature for a webhook, SMTP send without a password). Returning `null` remains
 * the contract — but the failure now leaves an actionable trace, one per minute and per pattern.
 */
function reportUnreadable(reason: string, context: Record<string, unknown> = {}): void {
  const now = Date.now();
  if (now - (lastLogged.get(reason) ?? 0) < LOG_THROTTLE_MS) return;
  lastLogged.set(reason, now);
  const derived = usesDerivedEncryptionKey();
  logger.error(
    {
      reason,
      derivedEncryptionKey: derived,
      // The action to take travels with the event: a log that only says "null" sends the operator
      // searching the code at the worst moment.
      remedy: derived ? REMEDY_DERIVED : REMEDY_EXPLICIT,
      ...context,
    },
    LOG_UNREADABLE,
  );
}

/** Once per process: states that the installation relies on the derived key. */
function warnDerivedKeyOnce(): void {
  if (derivedKeyWarned || !usesDerivedEncryptionKey()) return;
  derivedKeyWarned = true;
  logger.warn(LOG_DERIVED_KEY);
}

/** Encrypts a string → `iv.tag.ciphertext.kid`. */
export function encryptSecret(plain: string): string {
  warnDerivedKeyOnce();
  const k = key();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', k, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64'), keyId(k)].join('.');
}

/**
 * Decrypts a value produced by `encryptSecret`. `null` if the format is invalid, if the envelope was
 * altered, or if the key is no longer the right one — this last case is now NAMED in the log instead of
 * being confused with the other two.
 *
 * Values written before the key fingerprint have only three fields: they remain decryptable as-is, and
 * will be rewritten in the full format at the next save.
 */
export function decryptSecret(payload: string): string | null {
  warnDerivedKeyOnce();
  const parts = payload.split('.');
  // `dataB` may be empty (encrypted empty string); `kid` is optional (legacy).
  if (parts.length !== 3 && parts.length !== 4) {
    reportUnreadable('format', { fields: parts.length });
    return null;
  }
  const [ivB, tagB, dataB, kid] = parts as [string, string, string, string | undefined];
  const k = key();
  if (kid !== undefined && kid !== keyId(k)) {
    reportUnreadable('key-mismatch', { envelopeKeyId: kid, currentKeyId: keyId(k) });
    return null;
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', k, Buffer.from(ivB, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB, 'base64'));
    const dec = Buffer.concat([decipher.update(Buffer.from(dataB, 'base64')), decipher.final()]);
    return dec.toString('utf8');
  } catch {
    reportUnreadable('auth-failed', { keyIdPresent: kid !== undefined });
    return null;
  }
}

/** Resets the log anti-repeat state (tests). */
export const __cryptoTesting = {
  resetLogState(): void {
    lastLogged.clear();
    derivedKeyWarned = false;
  },
};
