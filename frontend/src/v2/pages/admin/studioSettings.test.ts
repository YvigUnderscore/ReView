// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  SETTINGS_FIELDS,
  SETTINGS_HOMES,
  fieldDisplay,
  fieldUnit,
  fieldsFor,
  isDirty,
  settingsPayload,
  type SettingField,
} from './studioSettings';

const field = (over: Partial<SettingField> = {}): SettingField => ({
  key: 'k',
  labelKey: 'common.save',
  hintKey: 'common.save',
  home: 'settings',
  ...over,
});

describe('settings distribution', () => {
  it('gives each field a known home', () => {
    for (const f of SETTINGS_FIELDS) expect(SETTINGS_HOMES, f.key).toContain(f.home);
  });

  it('leaves no field in two sections', () => {
    const keys = SETTINGS_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('puts each field where one looks for it', () => {
    const home = (key: string) => SETTINGS_FIELDS.find((f) => f.key === key)?.home;
    expect(home('storage_limit_user')).toBe('storage');
    expect(home('max_file_size')).toBe('storage');
    expect(home('trash_retention_days')).toBe('retention');
    expect(home('default_start_frame')).toBe('defaults');
    expect(home('slack_webhook_url')).toBe('chat');
    expect(home('live_sync_hz_video')).toBe('live');
    expect(home('studio_source_url')).toBe('settings');
  });

  it('renders the fields of a section, and nothing else', () => {
    expect(fieldsFor('live').map((f) => f.key)).toEqual([
      'live_sync_hz_video',
      'live_sync_hz_image',
      'live_sync_hz_3d',
      'live_sync_hz_splat',
    ]);
    expect(fieldsFor('retention').map((f) => f.key)).toEqual(['trash_retention_days']);
  });

  /** The catch-all section must not be rebuilt by accumulation. */
  it('leaves "Settings" with only the instance identity', () => {
    expect(fieldsFor('settings').map((f) => f.key)).toEqual(['studio_source_url']);
  });
});

describe('"something changed"', () => {
  it('stays inert as long as nothing is typed', () => {
    expect(isDirty({})).toBe(false);
    expect(isDirty({ a: '' })).toBe(true);
  });
});

describe('displayed value', () => {
  it('prefers the input in progress to the saved value', () => {
    const f = field({ key: 'max_concurrent_uploads' });
    expect(fieldDisplay(f, { max_concurrent_uploads: '5' }, {})).toBe('5');
    expect(fieldDisplay(f, { max_concurrent_uploads: '5' }, { max_concurrent_uploads: '9' })).toBe('9');
  });

  it('puts a size back in its readable unit', () => {
    const f = field({ key: 'max_file_size', bytes: true });
    const fiveGiB = String(5 * 1024 ** 3);
    expect(fieldDisplay(f, { max_file_size: fiveGiB }, {})).toBe('5');
    expect(fieldUnit(f, { max_file_size: fiveGiB }, {})).toBe('GB');
    expect(fieldUnit(f, { max_file_size: fiveGiB }, { max_file_size: 'MB' })).toBe('MB');
  });

  it('does not show a zero where nothing is set', () => {
    const f = field({ key: 'max_file_size', bytes: true });
    expect(fieldDisplay(f, {}, {})).toBe('');
  });
});

describe('writes sent', () => {
  const fields = [field({ key: 'quota', bytes: true }), field({ key: 'hook' })];

  it('sends only what was touched', () => {
    const { entries, invalidKey } = settingsPayload(fields, { hook: 'https://x' }, {});
    expect(invalidKey).toBeNull();
    expect(entries).toEqual([{ key: 'hook', value: 'https://x' }]);
  });

  it('converts sizes according to the displayed unit', () => {
    expect(settingsPayload(fields, { quota: '2' }, { quota: 'GB' }).entries).toEqual([
      { key: 'quota', value: String(2 * 1024 ** 3) },
    ]);
    expect(settingsPayload(fields, { quota: '2' }, { quota: 'MB' }).entries).toEqual([
      { key: 'quota', value: String(2 * 1024 ** 2) },
    ]);
  });

  it('refuses the whole save rather than writing half of it', () => {
    const res = settingsPayload(fields, { hook: 'https://x', quota: 'douze' }, { quota: 'GB' });
    expect(res.invalidKey).toBe('quota');
    expect(res.entries).toEqual([]);
  });

  /** Bespoke fields (language, accent, policy) share the same draft. */
  it('lets through a key that has no generic field', () => {
    expect(settingsPayload(fields, { studio_accent: '#ff0000' }, {}).entries).toEqual([
      { key: 'studio_accent', value: '#ff0000' },
    ]);
  });
});
