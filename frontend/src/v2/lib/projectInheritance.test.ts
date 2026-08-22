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
  resolution: { width: 1920, height: 1080 },
  framerate: 24,
};

/** Traducteur d'identité : les libellés ne sont pas l'objet du test. */
const fakeT = ((key: string) => key) as unknown as Tr;

describe('sameValue', () => {
  it('ignore l’ordre des clés', () => {
    expect(sameValue({ width: 1920, height: 1080 }, { height: 1080, width: 1920 })).toBe(true);
  });

  it('assimile une clé absente à une clé undefined', () => {
    expect(sameValue({ a: 1 }, { a: 1, b: undefined })).toBe(true);
  });

  it('distingue les tableaux par leur ordre', () => {
    expect(sameValue([1, 2], [2, 1])).toBe(false);
    expect(sameValue([{ k: 1 }], [{ k: 1 }])).toBe(true);
  });

  it('ne confond pas un objet vide et undefined', () => {
    expect(sameValue({}, undefined)).toBe(false);
  });
});

describe('changedSections — ce que la personne a réellement touché', () => {
  it('ne signale rien quand le brouillon est le point de départ recopié', () => {
    expect(changedSections(BASE, { ...BASE, resolution: { ...BASE.resolution } })).toEqual([]);
  });

  it('ne signale QUE la section modifiée', () => {
    expect(changedSections(BASE, { ...BASE, framerate: 25 })).toEqual(['framerate']);
  });

  it('sépare résolution et cadence', () => {
    expect(changedSections(BASE, { ...BASE, resolution: { width: 4096, height: 2160 } })).toEqual([
      'resolution',
    ]);
  });

  it('voit une section ajoutée comme une section modifiée', () => {
    const draft: ProjectSettings = { ...BASE, color: { configId: 'aces-1.3' } };
    expect(changedSections(BASE, draft)).toEqual(['color']);
  });
});

describe('buildSettingsPatch', () => {
  it('rend un PATCH vide quand rien n’a bougé — aucune surcharge n’est créée', () => {
    expect(buildSettingsPatch(BASE, { ...BASE })).toEqual({});
  });

  it('n’envoie que la section touchée, jamais les défauts studio autour', () => {
    expect(buildSettingsPatch(BASE, { ...BASE, framerate: 25 })).toEqual({ framerate: 25 });
  });

  it('traduit une section vidée en null (retour à l’héritage)', () => {
    const withColor: ProjectSettings = { ...BASE, color: { configId: 'aces-1.3' } };
    expect(buildSettingsPatch(withColor, { ...withColor, color: undefined })).toEqual({ color: null });
  });

  it('envoie plusieurs sections quand plusieurs ont bougé', () => {
    const draft: ProjectSettings = {
      ...BASE,
      framerate: 25,
      nomenclature: { ...BASE.nomenclature, shotPrefix: 'PL' },
    };
    expect(Object.keys(buildSettingsPatch(BASE, draft)).sort()).toEqual(['framerate', 'nomenclature']);
  });
});

describe('revertPatch', () => {
  it('met à null toutes les sections d’une ligne, et rien d’autre', () => {
    expect(revertPatch(['resolution', 'framerate'])).toEqual({ resolution: null, framerate: null });
  });
});

describe('inheritanceRows', () => {
  it('résume la valeur studio vers laquelle un retour ramènerait', () => {
    const rows = inheritanceRows(fakeT, BASE);
    expect(rows.find((r) => r.id === 'format')!.studioValue).toBe('1920×1080 · 24');
    expect(rows.find((r) => r.id === 'numbering')!.studioValue).toBe('SQ / SH · 3 · 10');
  });

  it('ne résume rien tant que les défauts studio ne sont pas connus', () => {
    expect(inheritanceRows(fakeT, undefined).every((r) => r.studioValue === undefined)).toBe(true);
  });

  it('couvre les huit sections d’override, sans doublon', () => {
    const sections = inheritanceRows(fakeT, BASE).flatMap((r) => r.sections);
    expect([...sections].sort()).toEqual([...SETTINGS_SECTIONS].sort());
  });
});
