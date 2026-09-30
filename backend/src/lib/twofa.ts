// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash, randomBytes } from 'node:crypto';
import { generate, generateSecret, generateURI, verify } from 'otplib';
import { getRedis } from './redis';
import { logger } from './logger';

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

/**
 * Normalisation d'un code saisi : casse, espaces et séparateurs de lisibilité ignorés.
 * Les codes de secours émis avant le passage à 128 bits n'avaient aucun séparateur —
 * leur hash est donc inchangé, et ils continuent de fonctionner.
 */
const normalizeCode = (code: string): string =>
  code
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

// ── Anti-rejeu du code TOTP ──────────────────────────────────────────────────

/**
 * Un code TOTP reste valide pendant tout son pas de temps (30 s, plus la tolérance
 * d'otplib). Sans mémoire des codes déjà présentés, celui qu'on intercepte — épaule,
 * hameçonnage en temps réel, journal d'un client mal réglé — se rejoue tant que la
 * fenêtre n'est pas passée : le second facteur ne prouve alors plus rien.
 *
 * Deux étages, et ils ne jouent pas le même rôle :
 *
 *  - `consumeTotpOnce` — garde LOCALE au process. Gratuite, elle court-circuite le rejeu
 *    déjà vu par CETTE réplique et rattrape une éviction du marqueur partagé sous pression
 *    mémoire. Elle ne suffit pas : elle ignore tout de ce que sert l'autre réplique.
 *  - `consumeTotpOnceShared` — garde PARTAGÉE (Redis), **la seule que la route de
 *    vérification doit appeler**. Sur deux répliques derrière le même frontal, la garde
 *    locale ne voit pas la tentative servie par l'autre : le code intercepté se rejoue en
 *    tombant sur la seconde. Le limiteur de débit a été porté sur Redis pour exactement ce
 *    motif (`middleware/rateLimit`), la présence et les salles live aussi.
 */
const REPLAY_TTL_MS = 120_000;
const REPLAY_MAX_ENTRIES = 50_000;
const usedTotp = new Map<string, number>();

const totpKey = (userId: number, code: string): string => `${userId}:${normalizeCode(code)}`;

/**
 * Enregistre un code TOTP comme consommé. Renvoie `false` s'il l'était déjà — l'appelant
 * doit alors refuser la vérification, exactement comme pour un code faux.
 */
export function consumeTotpOnce(userId: number, code: string): boolean {
  const now = Date.now();
  // Balayage à l'insertion : pas de timer à faire vivre, et la table reste bornée.
  for (const [k, until] of usedTotp) {
    if (until <= now) usedTotp.delete(k);
  }
  // Plafond de sûreté : mieux vaut oublier (et retomber sur le comportement d'avant) que
  // laisser une saturation mémoire devenir un déni de service.
  if (usedTotp.size >= REPLAY_MAX_ENTRIES) usedTotp.clear();

  const key = totpKey(userId, code);
  if ((usedTotp.get(key) ?? 0) > now) return false;
  usedTotp.set(key, now + REPLAY_TTL_MS);
  return true;
}

/** Marqueur partagé entre répliques. Le préfixe le range avec les autres états volatils. */
const totpRedisKey = (userId: number, code: string): string => `totp:used:${totpKey(userId, code)}`;

/**
 * Consommation d'un code TOTP valable pour TOUTE l'instance, répliques comprises.
 *
 * `SET … PX … NX` est atomique : la première réplique pose la clé et reçoit `OK`, la
 * seconde reçoit `null` et refuse. La garde locale reste interrogée d'abord — elle est
 * gratuite et évite un aller-retour sur un rejeu que cette réplique a déjà vu.
 *
 * ⚠ **Échec FERMÉ si Redis ne répond pas.** Un anti-rejeu qui a perdu la mémoire de ce qui
 * a été présenté ne peut pas répondre « jamais vu » : laisser passer ferait de la panne du
 * marqueur le moyen de le contourner — c'est mot pour mot la règle déjà tenue par le
 * limiteur de débit (`middleware/rateLimit`, échec fermé en 429). Et cette fermeture ne
 * coûte aucune disponibilité que la 2FA aurait encore : `/api/auth/2fa/verify` est précédé
 * de deux limiteurs eux-mêmes adossés à Redis, qui refusent la requête avant d'arriver ici
 * quand le serveur est injoignable.
 *
 * Effet de bord assumé : le code présenté pendant la panne est brûlé par la garde locale.
 * Il vaut trente secondes — l'utilisateur en lit un autre.
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

// ── Codes de secours ─────────────────────────────────────────────────────────

export const hashBackupCode = (code: string): string =>
  createHash('sha256').update(normalizeCode(code)).digest('hex');

/**
 * 10 codes de secours, **128 bits** chacun, groupés par 8 caractères pour la recopie.
 *
 * Les hashs sont stockés sans sel ni étirement : c'est tenable uniquement parce que le
 * code est assez long pour rendre la recherche exhaustive hors de portée. Les 40 bits
 * précédents (`randomBytes(5)`) se parcouraient sur un GPU si la base fuitait — d'où la
 * règle : ne pas raccourcir ces codes pour les rendre plus commodes.
 */
export function generateBackupCodes(): { plain: string[]; hashes: string[] } {
  const plain = Array.from({ length: 10 }, () =>
    (randomBytes(16).toString('hex').match(/.{8}/g) ?? []).join('-'),
  );
  return { plain, hashes: plain.map(hashBackupCode) };
}

/** Consomme un code de secours : renvoie la liste des hashs restants, ou null si invalide. */
export function consumeBackupCode(hashes: string[], code: string): string[] | null {
  const h = hashBackupCode(code);
  if (!hashes.includes(h)) return null;
  return hashes.filter((x) => x !== h);
}

export const __testing = { usedTotp };
