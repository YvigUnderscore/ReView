// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MessageKey } from '../../i18n';
import { bytesToUnit, parseSizeToBytes, type SizeUnit } from './adminShared';

/**
 * The studio key/value settings (`/api/studio/settings`) and, above all, **the section where
 * you go to find them**.
 *
 * `/admin/settings` used to stack fourteen unrelated settings: start frame, file size,
 * quota, concurrent uploads, trash retention, four live-room cadences, Slack webhook, AGPL
 * source URL, task policy, language and accent. Grouping them into families within one screen
 * never answered the real question: nobody looks for "the quota" under "Settings"; they look for it under "Storage".
 *
 * Each field therefore declares its **home**: the admin section that renders it. The field
 * has only one possible place, and the settings search indexes the right section without a parallel table.
 */

/** Sections that render at least one key/value setting. These are keys of `adminSections`. */
export const SETTINGS_HOMES = ['settings', 'storage', 'defaults', 'retention', 'live', 'chat'] as const;

export type SettingsHome = (typeof SETTINGS_HOMES)[number];

export interface SettingField {
  key: string;
  labelKey: MessageKey;
  hintKey: MessageKey;
  /** Admin section that renders this field. */
  home: SettingsHome;
  /** Field expressed as a size (MB/GB); input is converted to bytes on save. */
  bytes?: boolean;
}

export const SETTINGS_FIELDS: SettingField[] = [
  // Project defaults: the start frame is a creation default, not an instance setting;
  // it lives with the resolution and cadence it goes with.
  {
    key: 'default_start_frame',
    labelKey: 'settings.defaultStartFrame',
    hintKey: 'settings.hint.startFrame',
    home: 'defaults',
  },
  // Uploads and quotas: these are storage limits, and "Storage" is the screen that
  // already shows what the bucket contains. The default quota is authoritative here; the
  // account page only gives an override.
  {
    key: 'max_file_size',
    labelKey: 'settings.maxFileSize',
    hintKey: 'settings.hint.maxFileSize',
    home: 'storage',
    bytes: true,
  },
  {
    key: 'storage_limit_user',
    labelKey: 'settings.storageQuota',
    hintKey: 'settings.hint.storageQuota',
    home: 'storage',
    bytes: true,
  },
  {
    key: 'max_concurrent_uploads',
    labelKey: 'settings.maxUploads',
    hintKey: 'settings.hint.maxUploads',
    home: 'storage',
  },
  // Retention: the trash and the logs answer the same question: how long the studio
  // keeps what it has deleted. Separating them forced knowing two screens to answer a GDPR
  // request. The Trash links back here.
  {
    key: 'trash_retention_days',
    labelKey: 'settings.trashRetention',
    hintKey: 'settings.hint.trash',
    home: 'retention',
  },
  // Live review room (33.B): driver broadcasts per second, per media type (1-30).
  {
    key: 'live_sync_hz_video',
    labelKey: 'settings.liveVideo',
    hintKey: 'settings.hint.liveVideo',
    home: 'live',
  },
  {
    key: 'live_sync_hz_image',
    labelKey: 'settings.liveImage',
    hintKey: 'settings.hint.liveImage',
    home: 'live',
  },
  { key: 'live_sync_hz_3d', labelKey: 'settings.live3d', hintKey: 'settings.hint.liveCam', home: 'live' },
  {
    key: 'live_sync_hz_splat',
    labelKey: 'settings.liveSplat',
    hintKey: 'settings.hint.liveCamFocal',
    home: 'live',
  },
  // Team messaging: Slack and Discord are the same action ("notify the team"),
  // rendered by the same screen, where the Discord webhook exposed by the API had until then
  // no place to be configured.
  {
    key: 'slack_webhook_url',
    labelKey: 'settings.slackWebhook',
    hintKey: 'settings.hint.slack',
    home: 'chat',
  },
  // AGPL §13: the instance must offer ITS sources. Empty = upstream repository. This is an
  // identity mention of the instance, like its name.
  {
    key: 'studio_source_url',
    labelKey: 'settings.sourceUrl',
    hintKey: 'settings.hint.sourceUrl',
    home: 'settings',
  },
];

/** The fields a section renders, in declaration order. */
export const fieldsFor = (home: SettingsHome): SettingField[] =>
  SETTINGS_FIELDS.filter((field) => field.home === home);

/** Screen draft: the only keys touched since loading. */
export type SettingsDraft = Record<string, string>;
/** Unit chosen for size-based fields. */
export type SettingsUnits = Record<string, SizeUnit>;

/** Is there anything to save? This is what arms the action bar. */
export const isDirty = (draft: SettingsDraft): boolean => Object.keys(draft).length > 0;

/**
 * Value to display in the field: the current input if it exists, otherwise the
 * saved value, converted back to the readable unit for sizes.
 */
export function fieldDisplay(field: SettingField, stored: Record<string, string>, draft: SettingsDraft) {
  const typed = draft[field.key];
  if (typed !== undefined) return typed;
  if (!field.bytes) return stored[field.key] ?? '';
  const raw = Number(stored[field.key]) || 0;
  return raw ? bytesToUnit(raw).value : '';
}

/** Displayed unit: the one just chosen, otherwise the one the saved value imposes. */
export function fieldUnit(
  field: SettingField,
  stored: Record<string, string>,
  units: SettingsUnits,
): SizeUnit {
  return units[field.key] ?? bytesToUnit(Number(stored[field.key]) || 0).unit;
}

/** What the draft will send, or the key of the field that refuses to be read. */
export interface SettingsPayload {
  entries: { key: string; value: string }[];
  /** Key of the first size field that cannot be read; saving stops there. */
  invalidKey: string | null;
}

/**
 * Translates the draft into writes.
 *
 * A key absent from the draft is not sent: two administrators setting two neighbouring
 * fields do not overwrite each other. Size fields are converted to bytes according to the
 * displayed unit, and an unreadable number interrupts the whole save rather than writing
 * half of it.
 */
export function settingsPayload(
  fields: SettingField[],
  draft: SettingsDraft,
  units: SettingsUnits,
): SettingsPayload {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const entries: { key: string; value: string }[] = [];
  for (const [key, typed] of Object.entries(draft)) {
    const field = byKey.get(key);
    if (!field?.bytes) {
      entries.push({ key, value: typed });
      continue;
    }
    const bytes = parseSizeToBytes(typed, units[key] ?? 'Mo');
    if (bytes == null) return { entries: [], invalidKey: key };
    entries.push({ key, value: String(bytes) });
  }
  return { entries, invalidKey: null };
}
