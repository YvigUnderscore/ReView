// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { builtinCube, couplesFor, MAX_COUPLES } from './bakeJob';
import { parseCube } from '../../lib/ocioBake';

const displays = [
  { name: 'sRGB - Display', views: ['ACES 1.0 - SDR Video', 'Un-tone-mapped', 'Raw'] },
  { name: 'Rec.1886 Rec.709 - Display', views: ['ACES 1.0 - SDR Video', 'Raw'] },
];

describe('bakeJob — choix des couples', () => {
  it('cuit tous les couples de la config par défaut', () => {
    expect(couplesFor(displays, {})).toHaveLength(5);
  });

  it('un couple explicite ne cuit que lui', () => {
    expect(couplesFor(displays, { display: 'sRGB - Display', view: 'Raw' })).toEqual([
      { display: 'sRGB - Display', view: 'Raw' },
    ]);
  });

  it('un display seul ne suffit pas à cibler : la config entière est cuite', () => {
    expect(couplesFor(displays, { display: 'sRGB - Display' })).toHaveLength(5);
  });

  it('plafonne le nombre de couples (une config vérolée ne noie pas la file)', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      name: `D${i}`,
      views: ['Raw', 'Un-tone-mapped', 'Log', 'ACES 1.0 - SDR Video'],
    }));
    expect(couplesFor(many, {})).toHaveLength(MAX_COUPLES);
  });
});

describe('bakeJob — repli intégré', () => {
  it('produit un .cube relisible pour une vue colorimétrique', () => {
    const text = builtinCube('sRGB - Display', 'Un-tone-mapped')!;
    expect(text).toContain('LUT_3D_SIZE 33');
    expect(text).toContain('source: built-in colorimetric');
    expect(parseCube(text).size).toBe(33);
  });

  it('rend null pour une vue tone-mappée : cette LUT-là n’est pas approchée', () => {
    expect(builtinCube('sRGB - Display', 'ACES 1.0 - SDR Video')).toBeNull();
  });
});
