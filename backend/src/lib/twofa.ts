// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash, randomBytes } from 'node:crypto';
import { generate, generateSecret, generateURI, verify } from 'otplib';

/**
 * 2FA TOTP (36.A) — helpers (testés) au-dessus d'otplib v13 (API fonctionnelle, async).
 * Le secret est stocké chiffré (lib/crypto) sur User.totpSecret ; les codes de secours
 * sont stockés hashés (sha256) et consommés un par un.
 */

export const generateTotpSecret = (): string => generateSecret();

/** URI `otpauth://` pour le QR code (rendu côté client). */
export const otpauthUri = (email: string, issuer: string, secret: string): string =>
  generateURI({ secret, issuer, label: email });

/** Code TOTP courant (tests / outillage). */
export const currentTotp = (secret: string): Promise<string> => generate({ secret });

/** Vérifie un code TOTP (fenêtre gérée par otplib). */
export async function verifyTotp(secret: string, code: string): Promise<boolean> {
  try {
    const r = await verify({ secret, token: code.replace(/\s/g, '') });
    return r.valid === true;
  } catch {
    return false;
  }
}

export const hashBackupCode = (code: string): string =>
  createHash('sha256').update(code.trim().toLowerCase()).digest('hex');

/** 10 codes de secours (10 hex) — clairs montrés une fois, hashs stockés. */
export function generateBackupCodes(): { plain: string[]; hashes: string[] } {
  const plain = Array.from({ length: 10 }, () => randomBytes(5).toString('hex'));
  return { plain, hashes: plain.map(hashBackupCode) };
}

/** Consomme un code de secours : renvoie la liste des hashs restants, ou null si invalide. */
export function consumeBackupCode(hashes: string[], code: string): string[] | null {
  const h = hashBackupCode(code);
  if (!hashes.includes(h)) return null;
  return hashes.filter((x) => x !== h);
}
