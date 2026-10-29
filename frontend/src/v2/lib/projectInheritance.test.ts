// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  SETTINGS_SECTIONS,
  buildSettingsPatch,
  changedSections,
  inheritanceRows,
  revertPatch,
  sameValue,
} from './projectInheritance';
import type { Tr } from '../i18n';
import type { ProjectSettings } from '../types/api';

const BASE: ProjectSettings = {
  departments: [{ key: 'ANIM', name: 'Animation' }],
  nomenclature: { sequencePrefix: 'SQ', shotPrefix: 'SH', padding: 3, step: 10 },
  naming: { pattern: '', mode: 'off' },
  reviewRequest: { requireNote: false, minNoteLength: 5 },
  resolution: { width: 1920, height: 1080 },
  framerate: 24,
};

/** Identity translator: the labels are not the subject of the test. */
const fakeT = ((key: string) => key) as unknown as Tr;

describe('sameValue', () => {
  it('ignores key order', () => {
    expect(sameValue({ width: 1920, height: 1080 }, { height: 1080, width: 1920 })).toBe(true);
  });

  it('treats an absent key as an undefined key', () => {
    expect(sameValue({ a: 1 }, { a: 1, b: undefined })).toBe(true);
  });

  it('tells arrays apart by their order', () => {
    expect(sameValue([1, 2], [2, 1])).toBe(false);
    expect(sameValue([{ k: 1 }], [{ k: 1 }])).toBe(true);
  });

  it('does not confuse an empty object with undefined', () => {
    expect(sameValue({}, undefined)).toBe(false);
  });
});

describe('changedSections — what the person actually touched', () => {
  it('reports nothing when the draft is the copied starting point', () => {
    expect(changedSections(BASE, { ...BASE, resolution: { ...BASE.resolution } })).toEqual([]);
  });

  it('reports ONLY the modified section', () => {
    expect(changedSections(BASE, { ...BASE, framerate: 25 })).toEqual(['framerate']);
  });

  it('separates resolution and cadence', () => {
    expect(changedSections(BASE, { ...BASE, resolution: { width: 4096, height: 2160 } })).toEqual([
      'resolution',
    ]);
  });

  it('sees an added section as a modified one', () => {
    const draft: ProjectSettings = { ...BASE, color: { configId: 'aces-1.3' } };
    expect(changedSections(BASE, draft)).toEqual(['color']);
  });
});

describe('buildSettingsPatch', () => {
  it('returns an empty PATCH when nothing moved — no override is created', () => {
    expect(buildSettingsPatch(BASE, { ...BASE })).toEqual({});
  });

  it('sends only the touched section, never the studio defaults around it', () => {
    expect(buildSettingsPatch(BASE, { ...BASE, framerate: 25 })).toEqual({ framerate: 25 });
  });

  it('translates an emptied section to null (back to inheritance)', () => {
    const withColor: ProjectSettings = { ...BASE, color: { configId: 'aces-1.3' } };
    expect(buildSettingsPatch(withColor, { ...withColor, color: undefined })).toEqual({ color: null });
  });

  it('sends several sections when several moved', () => {
    const draft: ProjectSettings = {
      ...BASE,
      framerate: 25,
      nomenclature: { ...BASE.nomenclature, shotPrefix: 'PL' },
    };
    expect(Object.keys(buildSettingsPatch(BASE, draft)).sort()).toEqual(['framerate', 'nomenclature']);
  });
});

describe('revertPatch', () => {
  it('sets every section of a row to null, and nothing else', () => {
    expect(revertPatch(['resolution', 'framerate'])).toEqual({ resolution: null, framerate: null });
  });
});

describe('inheritanceRows', () => {
  it('summarises the studio value a revert would bring back', () => {
    const rows = inheritanceRows(fakeT, BASE);
    expect(rows.find((r) => r.id === 'format')!.studioValue).toBe('1920×1080 · 24');
    expect(rows.find((r) => r.id === 'numbering')!.studioValue).toBe('SQ / SH · 3 · 10');
  });

  it('summarises nothing while the studio defaults are not known', () => {
    expect(inheritanceRows(fakeT, undefined).every((r) => r.studioValue === undefined)).toBe(true);
  });

  it('covers the eight override sections, without duplicates', () => {
    const sections = inheritanceRows(fakeT, BASE).flatMap((r) => r.sections);
    expect([...sections].sort()).toEqual([...SETTINGS_SECTIONS].sort());
  });
});
