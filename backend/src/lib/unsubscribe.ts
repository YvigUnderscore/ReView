// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';

/**
 * Unsubscribe token for recurring mailings (digest, weekly report).
 *
 * It travels in the `List-Unsubscribe` header, which mail clients turn into a native button.
 * That button calls the address **without a session**: the token must therefore carry on its
 * own the recipient's identity and the nature of the mailing, and prove that it comes from us.
 *
 * Hence an HMAC signature: the token is readable, but forging another account's token requires
 * the server's key. Its scope is narrow: it unsubscribes from one type of mailing and nothing
 * else. It opens no session, reads nothing, and modifies no other preference.
 */

/** Recurring mailings that can be unsubscribed from. */
export const UNSUBSCRIBE_KINDS = ['emailDigest', 'weeklyReport'] as const;
export type UnsubscribeKind = (typeof UNSUBSCRIBE_KINDS)[number];

function signature(payload: string): string {
  return createHmac('sha256', env.JWT_SECRET).update(payload).digest('base64url');
}

/** `<userId>.<kind>.<signature>`: readable, verifiable, stateless on the server. */
export function signUnsubscribe(userId: number, kind: UnsubscribeKind): string {
  const payload = `${userId}.${kind}`;
  return `${payload}.${signature(payload)}`;
}

/** The recipient and targeted mailing, or `null` if the token is forged or malformed. */
export function verifyUnsubscribe(token: string): { userId: number; kind: UnsubscribeKind } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [rawId, rawKind, sig] = parts as [string, string, string];

  const userId = Number(rawId);
  if (!Number.isSafeInteger(userId) || userId <= 0) return null;
  if (!(UNSUBSCRIBE_KINDS as readonly string[]).includes(rawKind)) return null;

  // Constant-time comparison: an ordinary comparison lets the signature be guessed
  // byte by byte, by measuring the response time.
  const expected = Buffer.from(signature(`${rawId}.${rawKind}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  return { userId, kind: rawKind as UnsubscribeKind };
}

/** Public unsubscribe address, as it appears in the header and in the body. */
export function unsubscribeUrl(userId: number, kind: UnsubscribeKind): string | null {
  if (!env.APP_URL) return null;
  return `${env.APP_URL}/api/unsubscribe/${signUnsubscribe(userId, kind)}`;
}
