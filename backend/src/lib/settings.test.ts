// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db } = vi.hoisted(() => ({ db: { setting: { findUnique: vi.fn() } } }));
vi.mock('./prisma', () => ({ prisma: db }));

import {
  BOOLEAN_SETTING_KEYS,
  booleanSettingSchema,
  getBooleanSetting,
  isDraftModeEnabled,
  SETTING_KEYS,
  UPSTREAM_SOURCE_URL,
  safeSourceUrl,
} from './settings';

describe('safeSourceUrl', () => {
  it('accepts http and https', () => {
    expect(safeSourceUrl('https://git.studio.tld/review')).toBe('https://git.studio.tld/review');
    expect(safeSourceUrl('http://192.168.1.10:3000/sources')).toBe('http://192.168.1.10:3000/sources');
  });

  it('ignores the spaces around the value', () => {
    expect(safeSourceUrl('  https://example.org/review  ')).toBe('https://example.org/review');
  });

  it('falls back on upstream when the setting is empty', () => {
    for (const value of [null, undefined, '', '   ']) {
      expect(safeSourceUrl(value)).toBe(UPSTREAM_SOURCE_URL);
    }
  });

  it('refuses dangerous schemes: the value ends up in an href', () => {
    for (const value of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox',
      'file:///etc/passwd',
    ]) {
      expect(safeSourceUrl(value)).toBe(UPSTREAM_SOURCE_URL);
    }
  });

  it('refuses a string that is not a URL', () => {
    expect(safeSourceUrl('nos sources sont sur le NAS')).toBe(UPSTREAM_SOURCE_URL);
  });
});

/**
 * Draft mode (Phase 50) is a studio setting, and the `Setting` table stores only text. The whole stake lies there: "false" is a true string, and an absent
 * setting must give the default behaviour — automatic publication — and not the reverse.
 */
describe('getBooleanSetting / isDraftModeEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads "true" as true, and EVERYTHING else as false', async () => {
    for (const [value, expected] of [
      ['true', true],
      ['false', false],
      ['1', false],
      ['oui', false],
      ['', false],
    ] as const) {
      db.setting.findUnique.mockResolvedValue({ value });
      expect(await getBooleanSetting('whatever')).toBe(expected);
    }
  });

  it('falls back on false when the setting does not exist — fresh database included', async () => {
    db.setting.findUnique.mockResolvedValue(null);
    expect(await isDraftModeEnabled()).toBe(false);
  });

  it('reads `draftMode` under this exact name — contract shared with the interface', async () => {
    db.setting.findUnique.mockResolvedValue({ value: 'true' });
    expect(await isDraftModeEnabled()).toBe(true);
    expect(db.setting.findUnique).toHaveBeenCalledWith({ where: { key: 'draftMode' } });
    expect(SETTING_KEYS.DRAFT_MODE).toBe('draftMode');
    expect(BOOLEAN_SETTING_KEYS).toContain('draftMode');
  });

  it('refuses on write any value that is not one of the two words', () => {
    expect(booleanSettingSchema.safeParse('true').success).toBe(true);
    expect(booleanSettingSchema.safeParse('false').success).toBe(true);
    for (const value of ['True', '1', 'oui', '', 'yes']) {
      expect(booleanSettingSchema.safeParse(value).success).toBe(false);
    }
  });
});
