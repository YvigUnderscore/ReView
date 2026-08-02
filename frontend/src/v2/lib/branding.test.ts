// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { hexToHsl } from './branding';

describe('branding — hexToHsl (42.B №101)', () => {
  it('convertit des couleurs de base', () => {
    expect(hexToHsl('#000000')).toBe('0 0% 0%');
    expect(hexToHsl('#ffffff')).toBe('0 0% 100%');
    expect(hexToHsl('#ff0000')).toBe('0 100% 50%');
    expect(hexToHsl('#00ff00')).toBe('120 100% 50%');
    expect(hexToHsl('#0000ff')).toBe('240 100% 50%');
  });

  it('accepte avec ou sans « # » et insensible à la casse', () => {
    expect(hexToHsl('00B3C4')).toBe(hexToHsl('#00b3c4'));
  });

  it('renvoie null pour une entrée invalide', () => {
    expect(hexToHsl('#abc')).toBeNull();
    expect(hexToHsl('pas une couleur')).toBeNull();
    expect(hexToHsl('')).toBeNull();
  });
});
