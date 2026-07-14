import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { env } from '../config/env';

/**
 * Chiffrement symétrique des secrets stockés en base (mot de passe SMTP…) — AES-256-GCM.
 * La clé (32 octets) est dérivée par SHA-256 de `APP_ENCRYPTION_KEY` (ou à défaut de
 * `JWT_SECRET`, déjà durci en production). Format de sortie : `iv.tag.ciphertext` (base64).
 */
function key(): Buffer {
  return createHash('sha256')
    .update(env.APP_ENCRYPTION_KEY ?? env.JWT_SECRET)
    .digest();
}

/** Chiffre une chaîne → `iv.tag.ciphertext` base64. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.');
}

/** Déchiffre une valeur produite par `encryptSecret`. `null` si le format est invalide/altéré. */
export function decryptSecret(payload: string): string | null {
  try {
    const parts = payload.split('.');
    if (parts.length !== 3) return null; // dataB peut être vide (chiffré d'une chaîne vide)
    const [ivB, tagB, dataB] = parts as [string, string, string];
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB, 'base64'));
    const dec = Buffer.concat([decipher.update(Buffer.from(dataB, 'base64')), decipher.final()]);
    return dec.toString('utf8');
  } catch {
    return null;
  }
}
