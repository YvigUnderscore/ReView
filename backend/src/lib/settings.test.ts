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
  it('accepte http et https', () => {
    expect(safeSourceUrl('https://git.studio.tld/review')).toBe('https://git.studio.tld/review');
    expect(safeSourceUrl('http://192.168.1.10:3000/sources')).toBe('http://192.168.1.10:3000/sources');
  });

  it('ignore les espaces autour de la valeur', () => {
    expect(safeSourceUrl('  https://example.org/review  ')).toBe('https://example.org/review');
  });

  it('retombe sur l’amont quand le réglage est vide', () => {
    for (const value of [null, undefined, '', '   ']) {
      expect(safeSourceUrl(value)).toBe(UPSTREAM_SOURCE_URL);
    }
  });

  it('refuse les schémas dangereux : la valeur finit dans un href', () => {
    for (const value of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox',
      'file:///etc/passwd',
    ]) {
      expect(safeSourceUrl(value)).toBe(UPSTREAM_SOURCE_URL);
    }
  });

  it('refuse une chaîne qui n’est pas une URL', () => {
    expect(safeSourceUrl('nos sources sont sur le NAS')).toBe(UPSTREAM_SOURCE_URL);
  });
});

/**
 * Le mode brouillon (Phase 50) est un réglage de studio, et la table `Setting` ne stocke que
 * du texte. Tout l'enjeu est là : « false » est une chaîne vraie, et un réglage absent doit
 * donner le comportement par défaut — la publication d'office — et non l'inverse.
 */
describe('getBooleanSetting / isDraftModeEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lit « true » comme vrai, et TOUT le reste comme faux', async () => {
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

  it('retombe sur faux quand le réglage n’existe pas — base fraîche comprise', async () => {
    db.setting.findUnique.mockResolvedValue(null);
    expect(await isDraftModeEnabled()).toBe(false);
  });

  it('lit `draftMode` sous ce nom exact — contrat partagé avec l’interface', async () => {
    db.setting.findUnique.mockResolvedValue({ value: 'true' });
    expect(await isDraftModeEnabled()).toBe(true);
    expect(db.setting.findUnique).toHaveBeenCalledWith({ where: { key: 'draftMode' } });
    expect(SETTING_KEYS.DRAFT_MODE).toBe('draftMode');
    expect(BOOLEAN_SETTING_KEYS).toContain('draftMode');
  });

  it('refuse à l’écriture toute valeur qui n’est pas l’un des deux mots', () => {
    expect(booleanSettingSchema.safeParse('true').success).toBe(true);
    expect(booleanSettingSchema.safeParse('false').success).toBe(true);
    for (const value of ['True', '1', 'oui', '', 'yes']) {
      expect(booleanSettingSchema.safeParse(value).success).toBe(false);
    }
  });
});
