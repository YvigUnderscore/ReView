// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from './prisma';
import { BASE_LOCALE, isLocale, localeFromPreferences, type Locale } from '../i18n';

/**
 * Réglages studio configurables (table Setting). Valeurs par défaut si absentes.
 * Les clés sont aussi modifiables via PUT /api/studio/settings (admin).
 */
export const SETTING_KEYS = {
  MAX_FILE_SIZE: 'max_file_size', // octets
  STORAGE_LIMIT_USER: 'storage_limit_user', // octets (défaut si user.storageLimit null)
  MAX_CONCURRENT_UPLOADS: 'max_concurrent_uploads',
  TRASH_RETENTION_DAYS: 'trash_retention_days', // purge auto après N jours (0 = désactivée)
  DEFAULT_START_FRAME: 'default_start_frame', // frame de départ par défaut des nouveaux projets
  // Salle de review live (33.B) : fréquence de diffusion du pilote (Hz) par type de média.
  LIVE_SYNC_HZ_VIDEO: 'live_sync_hz_video',
  LIVE_SYNC_HZ_IMAGE: 'live_sync_hz_image',
  LIVE_SYNC_HZ_3D: 'live_sync_hz_3d',
  LIVE_SYNC_HZ_SPLAT: 'live_sync_hz_splat',
  // Logo studio (35.D) : clé MinIO — page client, burn-ins worker.
  STUDIO_LOGO: 'studio_logo_key',
  // Licence : URL du code source correspondant, exigée par l'AGPL §13 et affichée aux
  // utilisateurs distants. Tout studio qui déploie une version modifiée doit y pointer
  // SES sources, pas le dépôt amont.
  STUDIO_SOURCE_URL: 'studio_source_url',
  // Langue par défaut du studio : sert aux comptes qui n'ont rien choisi, et à tout ce
  // que le serveur rend sans navigateur en face (emails, notifications).
  STUDIO_DEFAULT_LOCALE: 'studio_default_locale',
} as const;

/** Dépôt amont — valeur par défaut du lien « code source » (AGPL §13). */
export const UPSTREAM_SOURCE_URL = 'https://github.com/YvigUnderscore/ReView';

/**
 * Normalise l'URL de source avant affichage : elle finit dans un `href`, et le réglage
 * est un champ texte libre. Seuls http(s) passent ; tout le reste retombe sur l'amont.
 */
export function safeSourceUrl(value: string | null | undefined): string {
  if (!value?.trim()) return UPSTREAM_SOURCE_URL;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : UPSTREAM_SOURCE_URL;
  } catch {
    return UPSTREAM_SOURCE_URL;
  }
}

/** URL du code source correspondant (AGPL §13), repli sur le dépôt amont. */
export async function getSourceUrl(): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key: SETTING_KEYS.STUDIO_SOURCE_URL } });
  return safeSourceUrl(row?.value);
}

/** Langue par défaut du studio (repli sur l'anglais, langue de base du produit). */
export async function getDefaultLocale(): Promise<Locale> {
  const row = await prisma.setting.findUnique({
    where: { key: SETTING_KEYS.STUDIO_DEFAULT_LOCALE },
  });
  return isLocale(row?.value) ? row.value : BASE_LOCALE;
}

/**
 * Langue d'un destinataire : son choix explicite, sinon le défaut du studio. Un email
 * part toujours dans une langue décidée, jamais dans celle du serveur.
 */
export async function resolveUserLocale(preferences: unknown): Promise<Locale> {
  return localeFromPreferences(preferences) ?? (await getDefaultLocale());
}

const DEFAULTS: Record<string, number> = {
  [SETTING_KEYS.MAX_FILE_SIZE]: 5 * 1024 * 1024 * 1024, // 5 Go
  [SETTING_KEYS.STORAGE_LIMIT_USER]: 10 * 1024 * 1024 * 1024, // 10 Go
  [SETTING_KEYS.MAX_CONCURRENT_UPLOADS]: 5,
  [SETTING_KEYS.TRASH_RETENTION_DAYS]: 30,
  [SETTING_KEYS.DEFAULT_START_FRAME]: 1001,
  [SETTING_KEYS.LIVE_SYNC_HZ_VIDEO]: 2,
  [SETTING_KEYS.LIVE_SYNC_HZ_IMAGE]: 4,
  [SETTING_KEYS.LIVE_SYNC_HZ_3D]: 10,
  [SETTING_KEYS.LIVE_SYNC_HZ_SPLAT]: 10,
};

/** Fréquence de sync live (Hz, bornée 1–30) pour un type de média. */
export async function getLiveSyncHz(kind: string): Promise<number> {
  const key =
    kind === 'VIDEO'
      ? SETTING_KEYS.LIVE_SYNC_HZ_VIDEO
      : kind === 'IMAGE'
        ? SETTING_KEYS.LIVE_SYNC_HZ_IMAGE
        : kind === 'SPLAT'
          ? SETTING_KEYS.LIVE_SYNC_HZ_SPLAT
          : SETTING_KEYS.LIVE_SYNC_HZ_3D;
  const hz = await getNumericSetting(key);
  return Math.min(30, Math.max(1, hz));
}

export async function getNumericSetting(key: string): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key } });
  if (row) {
    const n = Number(row.value);
    if (Number.isFinite(n)) return n;
  }
  return DEFAULTS[key] ?? 0;
}
