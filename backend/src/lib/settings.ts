// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';
import { prisma } from './prisma';
import { BASE_LOCALE, isLocale, localeFromPreferences, type Locale } from '../i18n';

/**
 * Configurable studio settings (Setting table). Default values if absent.
 * The keys can also be modified via PUT /api/studio/settings (admin).
 */
export const SETTING_KEYS = {
  MAX_FILE_SIZE: 'max_file_size', // bytes
  STORAGE_LIMIT_USER: 'storage_limit_user', // bytes (default if user.storageLimit is null)
  MAX_CONCURRENT_UPLOADS: 'max_concurrent_uploads',
  TRASH_RETENTION_DAYS: 'trash_retention_days', // automatic purge after N days (0 = disabled)
  DEFAULT_START_FRAME: 'default_start_frame', // default start frame of new projects
  // Live review room (33.B): broadcast frequency of the pilot (Hz) per media type.
  LIVE_SYNC_HZ_VIDEO: 'live_sync_hz_video',
  LIVE_SYNC_HZ_IMAGE: 'live_sync_hz_image',
  LIVE_SYNC_HZ_3D: 'live_sync_hz_3d',
  LIVE_SYNC_HZ_SPLAT: 'live_sync_hz_splat',
  // Studio logo (35.D): MinIO key — client page, worker burn-ins.
  STUDIO_LOGO: 'studio_logo_key',
  // Licence: URL of the corresponding source code, required by AGPL §13 and shown to remote users. Any studio deploying a modified version must point
  // to ITS sources, not to the upstream repository.
  STUDIO_SOURCE_URL: 'studio_source_url',
  // Default language of the studio: used for accounts that chose nothing, and for everything the server renders without a browser in front (emails, notifications).
  STUDIO_DEFAULT_LOCALE: 'studio_default_locale',
  // Who writes to a task: "open" (the assignee, historical rule) or "department" (the assignee and the members of the step). See lib/taskDepartmentPolicy.
  TASK_DEPARTMENT_POLICY: 'task_department_policy',
  // Draft mode (Phase 50). ACTIVE: a media is born a draft and is published by an explicit gesture — the historical operation. INACTIVE (default): a media is
  // published as soon as it is uploaded, and "publish" is no longer a gesture.
  // The key is written `draftMode` and not in lowercase snake case like its neighbours: it is the contract agreed with the interface, which writes it as-is.
  // A case mismatch would have read an absent setting — hence disabled — without anything signalling it.
  DRAFT_MODE: 'draftMode',
} as const;

/**
 * Settings whose value is a boolean.
 *
 * The `Setting` table stores only text, and "false" there is a perfectly true string: without a schema, "no" or "0" would be saved and read back silently
 * as *false*, or as *true*, depending on the reader. Two words are accepted, not three.
 */
export const BOOLEAN_SETTING_KEYS: readonly string[] = [SETTING_KEYS.DRAFT_MODE];

/** Forced shape of a boolean setting's value (Zod: refused with a 400 on the route side). */
export const booleanSettingSchema = z.enum(['true', 'false']);

/** Upstream repository — default value of the "source code" link (AGPL §13). */
export const UPSTREAM_SOURCE_URL = 'https://github.com/YvigUnderscore/ReView';

/**
 * Normalises the source URL before display: it ends up in an `href`, and the setting is a free text field. Only http(s) passes; everything else falls back on upstream.
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

/** URL of the corresponding source code (AGPL §13), falling back on the upstream repository. */
export async function getSourceUrl(): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key: SETTING_KEYS.STUDIO_SOURCE_URL } });
  return safeSourceUrl(row?.value);
}

/** Default language of the studio (falls back on English, the product's base language). */
export async function getDefaultLocale(): Promise<Locale> {
  const row = await prisma.setting.findUnique({
    where: { key: SETTING_KEYS.STUDIO_DEFAULT_LOCALE },
  });
  return isLocale(row?.value) ? row.value : BASE_LOCALE;
}

/**
 * Language of a recipient: their explicit choice, otherwise the studio default. An email always goes out in a decided language, never in the server's.
 */
export async function resolveUserLocale(preferences: unknown): Promise<Locale> {
  return localeFromPreferences(preferences) ?? (await getDefaultLocale());
}

const DEFAULTS: Record<string, number> = {
  [SETTING_KEYS.MAX_FILE_SIZE]: 5 * 1024 * 1024 * 1024, // 5 GB
  [SETTING_KEYS.STORAGE_LIMIT_USER]: 10 * 1024 * 1024 * 1024, // 10 GB
  [SETTING_KEYS.MAX_CONCURRENT_UPLOADS]: 5,
  [SETTING_KEYS.TRASH_RETENTION_DAYS]: 30,
  [SETTING_KEYS.DEFAULT_START_FRAME]: 1001,
  [SETTING_KEYS.LIVE_SYNC_HZ_VIDEO]: 2,
  [SETTING_KEYS.LIVE_SYNC_HZ_IMAGE]: 4,
  [SETTING_KEYS.LIVE_SYNC_HZ_3D]: 10,
  [SETTING_KEYS.LIVE_SYNC_HZ_SPLAT]: 10,
};

/** Live sync frequency (Hz, bounded 1–30) for a media type. */
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

/**
 * Boolean value of a setting: an absent or badly filled-in setting is **false**.
 *
 * The fallback to `false` is no accident: the studio's boolean settings unlock additional behaviours. A fresh database, or a value an operator wrote wrongly,
 * must give the default behaviour, not one nobody asked for.
 */
export async function getBooleanSetting(key: string): Promise<boolean> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value === 'true';
}

/**
 * Does the studio work in draft mode? (Phase 50)
 *
 * Answers `false` by default: a media is published as soon as it is uploaded. The studio that wants to keep the former operation — deposit, review, publish — ticks
 * the setting, and regains exactly what it had.
 */
export const isDraftModeEnabled = (): Promise<boolean> => getBooleanSetting(SETTING_KEYS.DRAFT_MODE);

export async function getNumericSetting(key: string): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key } });
  if (row) {
    const n = Number(row.value);
    if (Number.isFinite(n)) return n;
  }
  return DEFAULTS[key] ?? 0;
}
