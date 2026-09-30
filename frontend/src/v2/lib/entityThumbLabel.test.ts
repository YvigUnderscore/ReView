// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { thumbAbbrev, thumbScale } from './entityThumbLabel';

/**
 * L'abrégé sert des noms de production, pas des noms de personnes : deux plans d'une même
 * séquence partagent tout sauf leur numéro. Prendre les initiales les rendrait identiques.
 */
describe('thumbAbbrev', () => {
  it('retient le dernier nombre du nom — c’est lui qui distingue deux plans', () => {
    expect(thumbAbbrev('SH0120')).toBe('0120');
    expect(thumbAbbrev('SQ010_SH0130')).toBe('0130');
    expect(thumbAbbrev('EP02')).toBe('02');
  });

  it('borne l’abrégé à quatre chiffres', () => {
    expect(thumbAbbrev('SH1234567')).toBe('4567');
  });

  it('retombe sur les initiales quand le nom ne porte aucun chiffre', () => {
    expect(thumbAbbrev('Le Grand Voyage')).toBe('LG');
    expect(thumbAbbrev('bunker')).toBe('BU');
    expect(thumbAbbrev('deep_forest')).toBe('DF');
  });

  it('ne coupe pas un caractère en deux moitiés', () => {
    // Emoji et idéogrammes tiennent sur deux unités de code : un `slice(0, 2)` naïf
    // rendrait une moitié de caractère, affichée en losange noir.
    expect(thumbAbbrev('🎬 clap')).toBe('🎬C');
  });

  it('accepte un nom vide sans rien inventer', () => {
    expect(thumbAbbrev('   ')).toBe('');
  });
});

describe('thumbScale', () => {
  it('réduit la police à mesure que le nom s’allonge', () => {
    expect(thumbScale('SQ010')).toBe('text-xl');
    expect(thumbScale('Le Grand Voyage')).toBe('text-base');
    expect(thumbScale('Le Grand Voyage de Mémé')).toBe('text-sm');
    expect(thumbScale('x'.repeat(40))).toBe('text-xs');
  });
});
