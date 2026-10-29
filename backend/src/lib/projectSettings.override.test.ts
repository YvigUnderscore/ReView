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

/** Studio reference defaults — the project inherits from them. */
const STUDIO: ProjectSettings = {
  departments: [{ key: 'ANIM', name: 'Animation' }],
  nomenclature: { sequencePrefix: 'SQ', shotPrefix: 'SH', padding: 3, step: 10 },
  naming: { pattern: '', mode: 'off' },
  reviewRequest: { requireNote: false, minNoteLength: 5 },
  resolution: { width: 1920, height: 1080 },
  framerate: 24,
  defaultLighting: { exposure: 1, rotationDeg: 0, showBackground: true, groundShadow: false },
  color: { configId: 'aces-1.3' },
};

describe('sanitizeOverride — returns ONLY what the project overrides', () => {
  it('returns an empty override for an empty JSON (everything is inherited)', () => {
    expect(sanitizeOverride({}, STUDIO)).toEqual({});
    expect(overriddenSections(sanitizeOverride({}, STUDIO))).toEqual([]);
  });

  it('NEVER completes absent sections with the studio defaults', () => {
    const override = sanitizeOverride({ framerate: 25 }, STUDIO);
    expect(override).toEqual({ framerate: 25 });
    expect(override.resolution).toBeUndefined();
    expect(override.nomenclature).toBeUndefined();
    expect(override.color).toBeUndefined();
  });

  it('bounds the overridden values like the effective reading does', () => {
    const override = sanitizeOverride({ framerate: 9999, resolution: { width: -3, height: 720 } }, STUDIO);
    expect(override.framerate).toBe(240);
    expect(override.resolution).toEqual({ width: 1, height: 720 });
  });

  it('ignores a null or empty section rather than freezing it', () => {
    expect(sanitizeOverride({ color: null, burnin: {}, defaultLighting: null }, STUDIO)).toEqual({});
  });

  it('ignores unknown keys and incomplete department entries', () => {
    const override = sanitizeOverride(
      { isTemplate: true, departments: [{ key: 'FX', name: 'FX' }, { key: 'CASSE' }] },
      STUDIO,
    );
    expect(override).toEqual({ departments: [{ key: 'FX', name: 'FX' }] });
  });

  it('refuses an explosive naming pattern, even as an override', () => {
    expect(() => sanitizeOverride({ naming: { pattern: '(a+)+$', mode: 'reject' } }, STUDIO)).toThrow();
  });
});

describe('patchStoredSettings — section-by-section write', () => {
  it('adds only the section sent: the rest keeps inheriting', () => {
    const next = patchStoredSettings({}, { resolution: { width: 4096, height: 2160 } }, STUDIO);
    expect(Object.keys(next)).toEqual(['resolution']);
  });

  it('leaves the sections absent from the PATCH intact', () => {
    const stored = { framerate: 25 };
    const next = patchStoredSettings(stored, { nomenclature: STUDIO.nomenclature }, STUDIO);
    expect(next.framerate).toBe(25);
    expect(next.nomenclature).toEqual(STUDIO.nomenclature);
  });

  it('returns a section to inheritance when it is null', () => {
    const stored = { framerate: 25, resolution: { width: 4096, height: 2160 } };
    const next = patchStoredSettings(stored, { framerate: null }, STUDIO);
    expect(next.framerate).toBeUndefined();
    expect(next.resolution).toEqual({ width: 4096, height: 2160 });
  });

  it('preserves the keys outside the settings (isTemplate) that the former PUT erased', () => {
    const next = patchStoredSettings({ isTemplate: true, framerate: 25 }, { framerate: 30 }, STUDIO);
    expect(next.isTemplate).toBe(true);
    expect(next.framerate).toBe(30);
  });

  it('freezes nothing when the PATCH is empty', () => {
    expect(patchStoredSettings({ framerate: 25 }, {}, STUDIO)).toEqual({ framerate: 25 });
  });

  it('purges from storage the keys that are neither a section nor a usable value', () => {
    const next = patchStoredSettings({ framerate: 'vingt-cinq' }, {}, STUDIO);
    expect(next.framerate).toBeUndefined();
  });
});

describe('replaceStoredSettings — full replacement of the override (PUT)', () => {
  it('keeps only the sections present in the body', () => {
    const next = replaceStoredSettings(
      { framerate: 25, color: { configId: 'x' } },
      { framerate: 30 },
      STUDIO,
    );
    expect(next).toEqual({ framerate: 30 });
  });

  it('still keeps the keys outside the settings', () => {
    const next = replaceStoredSettings({ isTemplate: true, framerate: 25 }, {}, STUDIO);
    expect(next).toEqual({ isTemplate: true });
  });
});

describe('projectSettingsPatchSchema', () => {
  it('accepts a single section, and null to return to inheritance', () => {
    expect(projectSettingsPatchSchema.parse({ framerate: 25 })).toEqual({ framerate: 25 });
    expect(projectSettingsPatchSchema.parse({ resolution: null })).toEqual({ resolution: null });
  });

  it('refuses an unknown key rather than losing it silently', () => {
    expect(() => projectSettingsPatchSchema.parse({ inconnue: 1 })).toThrow();
  });

  it('refuses a section value out of bounds', () => {
    expect(() => projectSettingsPatchSchema.parse({ framerate: 1000 })).toThrow();
  });

  it('covers exactly the declared sections', () => {
    expect(Object.keys(projectSettingsPatchSchema.shape).sort()).toEqual([...SETTINGS_SECTIONS].sort());
  });
});
