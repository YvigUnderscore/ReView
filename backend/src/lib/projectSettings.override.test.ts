// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  SETTINGS_SECTIONS,
  overriddenSections,
  patchStoredSettings,
  projectSettingsPatchSchema,
  replaceStoredSettings,
  sanitizeOverride,
  type ProjectSettings,
} from './projectSettings';

/** Défauts studio de référence — c'est d'eux que le projet hérite. */
const STUDIO: ProjectSettings = {
  departments: [{ key: 'ANIM', name: 'Animation' }],
  nomenclature: { sequencePrefix: 'SQ', shotPrefix: 'SH', padding: 3, step: 10 },
  naming: { pattern: '', mode: 'off' },
  resolution: { width: 1920, height: 1080 },
  framerate: 24,
  defaultLighting: { exposure: 1, rotationDeg: 0, showBackground: true, groundShadow: false },
  color: { configId: 'aces-1.3' },
};

describe('sanitizeOverride — ne rend QUE ce que le projet surcharge', () => {
  it('rend un override vide pour un JSON vide (tout est hérité)', () => {
    expect(sanitizeOverride({}, STUDIO)).toEqual({});
    expect(overriddenSections(sanitizeOverride({}, STUDIO))).toEqual([]);
  });

  it('ne complète JAMAIS les sections absentes avec les défauts studio', () => {
    const override = sanitizeOverride({ framerate: 25 }, STUDIO);
    expect(override).toEqual({ framerate: 25 });
    expect(override.resolution).toBeUndefined();
    expect(override.nomenclature).toBeUndefined();
    expect(override.color).toBeUndefined();
  });

  it('borne les valeurs surchargées comme la lecture effective', () => {
    const override = sanitizeOverride({ framerate: 9999, resolution: { width: -3, height: 720 } }, STUDIO);
    expect(override.framerate).toBe(240);
    expect(override.resolution).toEqual({ width: 1, height: 720 });
  });

  it('ignore une section nulle ou vide plutôt que de la figer', () => {
    expect(sanitizeOverride({ color: null, burnin: {}, defaultLighting: null }, STUDIO)).toEqual({});
  });

  it('ignore les clés inconnues et les entrées de département incomplètes', () => {
    const override = sanitizeOverride(
      { isTemplate: true, departments: [{ key: 'FX', name: 'FX' }, { key: 'CASSE' }] },
      STUDIO,
    );
    expect(override).toEqual({ departments: [{ key: 'FX', name: 'FX' }] });
  });

  it('refuse un motif de nomenclature explosif, même en override', () => {
    expect(() => sanitizeOverride({ naming: { pattern: '(a+)+$', mode: 'reject' } }, STUDIO)).toThrow();
  });
});

describe('patchStoredSettings — écriture section par section', () => {
  it('n’ajoute que la section envoyée : le reste continue d’hériter', () => {
    const next = patchStoredSettings({}, { resolution: { width: 4096, height: 2160 } }, STUDIO);
    expect(Object.keys(next)).toEqual(['resolution']);
  });

  it('laisse intactes les sections absentes du PATCH', () => {
    const stored = { framerate: 25 };
    const next = patchStoredSettings(stored, { nomenclature: STUDIO.nomenclature }, STUDIO);
    expect(next.framerate).toBe(25);
    expect(next.nomenclature).toEqual(STUDIO.nomenclature);
  });

  it('rend une section à l’héritage quand elle vaut null', () => {
    const stored = { framerate: 25, resolution: { width: 4096, height: 2160 } };
    const next = patchStoredSettings(stored, { framerate: null }, STUDIO);
    expect(next.framerate).toBeUndefined();
    expect(next.resolution).toEqual({ width: 4096, height: 2160 });
  });

  it('préserve les clés hors réglages (isTemplate) que l’ancien PUT effaçait', () => {
    const next = patchStoredSettings({ isTemplate: true, framerate: 25 }, { framerate: 30 }, STUDIO);
    expect(next.isTemplate).toBe(true);
    expect(next.framerate).toBe(30);
  });

  it('ne fige rien quand le PATCH est vide', () => {
    expect(patchStoredSettings({ framerate: 25 }, {}, STUDIO)).toEqual({ framerate: 25 });
  });

  it('purge du stockage les clés qui ne sont ni une section ni une valeur exploitable', () => {
    const next = patchStoredSettings({ framerate: 'vingt-cinq' }, {}, STUDIO);
    expect(next.framerate).toBeUndefined();
  });
});

describe('replaceStoredSettings — remplacement total de l’override (PUT)', () => {
  it('ne retient que les sections présentes dans le corps', () => {
    const next = replaceStoredSettings(
      { framerate: 25, color: { configId: 'x' } },
      { framerate: 30 },
      STUDIO,
    );
    expect(next).toEqual({ framerate: 30 });
  });

  it('conserve tout de même les clés hors réglages', () => {
    const next = replaceStoredSettings({ isTemplate: true, framerate: 25 }, {}, STUDIO);
    expect(next).toEqual({ isTemplate: true });
  });
});

describe('projectSettingsPatchSchema', () => {
  it('accepte une section seule, et null pour revenir à l’héritage', () => {
    expect(projectSettingsPatchSchema.parse({ framerate: 25 })).toEqual({ framerate: 25 });
    expect(projectSettingsPatchSchema.parse({ resolution: null })).toEqual({ resolution: null });
  });

  it('refuse une clé inconnue plutôt que de la perdre en silence', () => {
    expect(() => projectSettingsPatchSchema.parse({ inconnue: 1 })).toThrow();
  });

  it('refuse une valeur de section hors bornes', () => {
    expect(() => projectSettingsPatchSchema.parse({ framerate: 1000 })).toThrow();
  });

  it('couvre exactement les sections déclarées', () => {
    expect(Object.keys(projectSettingsPatchSchema.shape).sort()).toEqual([...SETTINGS_SECTIONS].sort());
  });
});
