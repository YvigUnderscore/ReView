// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  clampSettings,
  DEFAULT_COLOR_SETTINGS,
  isNeutral,
  readStoredSettings,
  resolveDisplayView,
  writeStoredSettings,
  type ColorSettings,
} from './colorSettings';

const displays = [
  { name: 'sRGB - Display', views: ['ACES 1.0 - SDR Video', 'Raw'] },
  { name: 'Rec.1886 Rec.709 - Display', views: ['ACES 1.0 - SDR Video'] },
];

const project = { configId: 'cfg', display: 'sRGB - Display', view: 'ACES 1.0 - SDR Video' };

describe('colorSettings — bornes', () => {
  it('ramène toute entrée douteuse dans le domaine utile', () => {
    const s = clampSettings({ exposure: 42, gamma: -3, display: '   ', view: 'x'.repeat(400) });
    expect(s.exposure).toBe(6);
    expect(s.gamma).toBe(0.2);
    expect(s.display).toBeNull();
    expect(s.view).toBeNull();
    expect(s.enabled).toBe(true);
  });

  it('une valeur non numérique ne casse rien', () => {
    const s = clampSettings({ exposure: Number.NaN, gamma: undefined });
    expect(s.exposure).toBe(0);
    expect(s.gamma).toBe(1);
  });

  it('isNeutral décrit exactement « rien à remettre à zéro »', () => {
    expect(isNeutral(DEFAULT_COLOR_SETTINGS)).toBe(true);
    expect(isNeutral({ ...DEFAULT_COLOR_SETTINGS, exposure: 0.05 })).toBe(false);
    expect(isNeutral({ ...DEFAULT_COLOR_SETTINGS, enabled: false })).toBe(false);
    expect(isNeutral({ ...DEFAULT_COLOR_SETTINGS, display: 'sRGB - Display' })).toBe(false);
  });
});

describe('colorSettings — couple display/view effectif', () => {
  const base: ColorSettings = { ...DEFAULT_COLOR_SETTINGS };

  it('sans config de projet, il n’y a rien à appliquer', () => {
    expect(resolveDisplayView(base, null, displays)).toBeNull();
    expect(resolveDisplayView(base, { display: 'x', view: 'y' }, displays)).toBeNull();
  });

  it('retombe sur le couple du projet', () => {
    expect(resolveDisplayView(base, project, displays)).toEqual({
      configId: 'cfg',
      display: 'sRGB - Display',
      view: 'ACES 1.0 - SDR Video',
      overridden: false,
    });
  });

  it('le choix du lecteur l’emporte s’il existe dans la config', () => {
    const s = { ...base, display: 'sRGB - Display', view: 'Raw' };
    expect(resolveDisplayView(s, project, displays)).toMatchObject({ view: 'Raw', overridden: true });
  });

  it('un choix hérité d’un autre projet est ignoré', () => {
    const s = { ...base, display: 'P3-D65 - Display', view: 'ACES 1.0 - SDR Video' };
    expect(resolveDisplayView(s, project, displays)).toMatchObject({
      display: 'sRGB - Display',
      overridden: false,
    });
  });

  it('un couple projet absent de la config chargée ne vaut plus rien', () => {
    const stale = { configId: 'cfg', display: 'Gone - Display', view: 'Raw' };
    expect(resolveDisplayView(base, stale, displays)).toBeNull();
    // Tant que la liste n'est pas chargée, on fait confiance au projet.
    expect(resolveDisplayView(base, stale, [])).toMatchObject({ display: 'Gone - Display' });
  });
});

describe('colorSettings — persistance', () => {
  it('écrit puis relit les réglages', () => {
    const store = new Map<string, string>();
    const io = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    writeStoredSettings({ ...DEFAULT_COLOR_SETTINGS, exposure: 1.5, enabled: false }, io);
    expect(readStoredSettings(io)).toMatchObject({ exposure: 1.5, enabled: false });
  });

  it('une préférence corrompue retombe sur les valeurs par défaut', () => {
    expect(readStoredSettings({ getItem: () => '{oops' })).toEqual(DEFAULT_COLOR_SETTINGS);
    expect(readStoredSettings({ getItem: () => null })).toEqual(DEFAULT_COLOR_SETTINGS);
  });

  it('un stockage indisponible n’empêche pas d’ajuster l’image', () => {
    expect(() =>
      writeStoredSettings(DEFAULT_COLOR_SETTINGS, {
        setItem: () => {
          throw new Error('quota');
        },
      }),
    ).not.toThrow();
  });
});
