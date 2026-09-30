// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, afterEach } from 'vitest';
import { applyAccent, hexToHsl } from './branding';

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

/**
 * L'accent choisi par un administrateur sert à trois choses : l'aplat des boutons, la
 * couleur du texte accentué, et l'anneau de focus. Les deux dernières se lisent SUR le
 * fond : appliquer la même teinte vive aux deux thèmes laissait `#1ec6dc` à 1,93:1 sur le
 * fond clair — focus clavier invisible, liens illisibles.
 */
describe('branding — l’accent studio s’adapte au thème', () => {
  const root = document.documentElement;
  const lightnessOf = (prop: string) =>
    Number.parseFloat(root.style.getPropertyValue(prop).split(' ')[2] ?? '');

  afterEach(() => {
    applyAccent(null);
    root.classList.remove('dark');
  });

  it('assombrit un accent trop clair en thème clair', () => {
    root.classList.remove('dark');
    applyAccent('#1ec6dc'); // L = 49 %
    expect(lightnessOf('--primary')).toBeLessThanOrEqual(38);
    expect(lightnessOf('--ring')).toBeLessThanOrEqual(38);
  });

  it('éclaircit un accent trop sombre en thème sombre', () => {
    root.classList.add('dark');
    applyAccent('#0a3d46'); // accent très sombre
    expect(lightnessOf('--primary')).toBeGreaterThanOrEqual(45);
  });

  it('laisse un accent déjà lisible tel quel', () => {
    root.classList.add('dark');
    applyAccent('#1ec6dc');
    expect(lightnessOf('--primary')).toBeCloseTo(49, 0);
  });

  it('rend la main aux tokens du thème quand l’accent est retiré', () => {
    applyAccent('#1ec6dc');
    applyAccent(null);
    expect(root.style.getPropertyValue('--primary')).toBe('');
    expect(root.style.getPropertyValue('--ring')).toBe('');
  });
});
