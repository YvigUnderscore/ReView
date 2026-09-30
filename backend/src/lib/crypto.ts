// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createCipheriv, createDecipheriv, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';
import { logger } from './logger';

/**
 * Comparaison de deux secrets en temps constant. Les chaînes sont d'abord réduites à un
 * SHA-256 : `timingSafeEqual` exige des buffers de même longueur, et hasher évite en prime
 * de laisser fuir la longueur du secret attendu par le temps de réponse.
 */
export function secretEquals(a: string | undefined | null, b: string | undefined | null): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Chiffrement symétrique des secrets stockés en base (mot de passe SMTP, secret client
 * OIDC, secret de webhook, identifiants ShotGrid, secret TOTP) — AES-256-GCM.
 * La clé (32 octets) est dérivée par SHA-256 de `APP_ENCRYPTION_KEY` (ou à défaut de
 * `JWT_SECRET`). Format de sortie : `iv.tag.ciphertext.kid` (base64, `kid` en hexa).
 */

/**
 * Empreinte de la clé, écrite EN CLAIR dans l'enveloppe.
 *
 * Elle ne protège rien — GCM s'en charge — elle diagnostique. Sans elle, un secret chiffré
 * avec une autre clé est indistinguable d'un secret corrompu : les deux sortent en `null`,
 * et l'exploitant ne sait pas s'il doit retrouver sa clé ou ressaisir la valeur. Or le cas
 * arrive par un geste NORMAL : `APP_ENCRYPTION_KEY` étant facultative, la clé dérive par
 * défaut de `JWT_SECRET` — faire tourner ce dernier après une fuite de jeton (la réponse
 * correcte à un incident) rend d'un coup illisibles TOUS les secrets stockés, en silence.
 * 32 bits d'empreinte suffisent à le dire, et ne disent rien de la clé elle-même.
 */
const KEY_ID_HEX_LENGTH = 8;

/** Fenêtre d'anti-répétition des journaux : une panne de clé touche chaque secret lu. */
const LOG_THROTTLE_MS = 60_000;

const LOG_UNREADABLE = '[crypto] secret stocké illisible';
const REMEDY_DERIVED =
  'APP_ENCRYPTION_KEY absente : la clé dérive de JWT_SECRET, qu’une rotation suffit à casser. La poser explicitement découple les deux, puis ressaisir les secrets.';
const REMEDY_EXPLICIT =
  'Restaurer APP_ENCRYPTION_KEY à sa valeur précédente, ou ressaisir les secrets concernés (SMTP, OIDC, webhooks, ShotGrid, 2FA).';
const LOG_DERIVED_KEY =
  '[crypto] APP_ENCRYPTION_KEY absente : les secrets stockés sont chiffrés avec une clé dérivée de JWT_SECRET. Faire tourner JWT_SECRET les rendra tous illisibles.';

const keyMaterial = (): string => env.APP_ENCRYPTION_KEY ?? env.JWT_SECRET;

/** Vrai si la clé de chiffrement dérive de `JWT_SECRET`, faute d'`APP_ENCRYPTION_KEY`. */
export const usesDerivedEncryptionKey = (): boolean => env.APP_ENCRYPTION_KEY === undefined;

function key(): Buffer {
  return createHash('sha256').update(keyMaterial()).digest();
}

const keyId = (k: Buffer): string => createHash('sha256').update(k).digest('hex').slice(0, KEY_ID_HEX_LENGTH);

const lastLogged = new Map<string, number>();
let derivedKeyWarned = false;

/**
 * Consigne une panne de déchiffrement — ERREUR, pas silence, et avec le geste à faire.
 *
 * Le fail-open historique se lisait ici : chaque appelant remplaçait le `null` par `''`
 * ou `undefined` et continuait (signature HMAC vide pour un webhook, envoi SMTP sans mot
 * de passe). Rendre `null` reste le contrat — mais la panne laisse désormais une trace
 * exploitable, une seule par minute et par motif.
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
      // Le geste à faire voyage avec l'événement : un journal qui dit seulement « null »
      // envoie l'exploitant chercher dans le code au pire moment.
      remedy: derived ? REMEDY_DERIVED : REMEDY_EXPLICIT,
      ...context,
    },
    LOG_UNREADABLE,
  );
}

/** Une seule fois par process : dire que l'installation repose sur la clé dérivée. */
function warnDerivedKeyOnce(): void {
  if (derivedKeyWarned || !usesDerivedEncryptionKey()) return;
  derivedKeyWarned = true;
  logger.warn(LOG_DERIVED_KEY);
}

/** Chiffre une chaîne → `iv.tag.ciphertext.kid`. */
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
 * Déchiffre une valeur produite par `encryptSecret`. `null` si le format est invalide, si
 * l'enveloppe a été altérée, ou si la clé n'est plus la bonne — ce dernier cas étant
 * désormais NOMMÉ dans le journal au lieu de se confondre avec les deux autres.
 *
 * Les valeurs écrites avant l'empreinte de clé n'ont que trois champs : elles restent
 * déchiffrables telles quelles, et se réécriront au format complet à la prochaine saisie.
 */
export function decryptSecret(payload: string): string | null {
  warnDerivedKeyOnce();
  const parts = payload.split('.');
  // `dataB` peut être vide (chiffré d'une chaîne vide) ; `kid` est facultatif (héritage).
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

/** Remise à zéro de l'anti-répétition des journaux (tests). */
export const __cryptoTesting = {
  resetLogState(): void {
    lastLogged.clear();
    derivedKeyWarned = false;
  },
};
