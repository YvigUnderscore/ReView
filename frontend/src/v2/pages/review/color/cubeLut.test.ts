// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { parseCubeLut, readSource, sampleLut, tileLayout, toTiles } from './cubeLut';

/** Construit un `.cube` de taille `n` à partir d'une fonction de transfert. */
const makeCube = (
  n: number,
  f: (r: number, g: number, b: number) => [number, number, number],
  header = '',
) => {
  const lines = [header, `LUT_3D_SIZE ${n}`, 'DOMAIN_MIN 0.0 0.0 0.0', 'DOMAIN_MAX 1.0 1.0 1.0'];
  for (let b = 0; b < n; b++)
    for (let g = 0; g < n; g++)
      for (let r = 0; r < n; r++) {
        const v = f(r / (n - 1), g / (n - 1), b / (n - 1));
        lines.push(v.map((x) => x.toFixed(6)).join(' '));
      }
  return lines.join('\n');
};

const identity = (r: number, g: number, b: number): [number, number, number] => [r, g, b];

describe('cubeLut — lecture', () => {
  it('lit la taille et range les texels rouge en premier', () => {
    const lut = parseCubeLut(makeCube(5, identity));
    expect(lut.size).toBe(5);
    expect(lut.volume.length).toBe(5 * 5 * 5 * 4);
    // (r=4, g=0, b=2) → rouge saturé, vert nul, bleu à mi-course.
    const i = ((2 * 5 + 0) * 5 + 4) * 4;
    expect(lut.volume[i]).toBe(255);
    expect(lut.volume[i + 1]).toBe(0);
    expect(lut.volume[i + 2]).toBe(128);
    expect(lut.volume[i + 3]).toBe(255);
  });

  it('refuse un fichier tronqué, sans taille ou surdimensionné', () => {
    expect(() => parseCubeLut('0.0 0.0 0.0')).toThrow(/LUT_3D_SIZE missing/);
    expect(() => parseCubeLut('LUT_3D_SIZE 3\n0.0 0.0 0.0')).toThrow(/truncated/);
    expect(() => parseCubeLut('LUT_3D_SIZE 128\n')).toThrow(/unsupported/);
    expect(() => parseCubeLut('LUT_3D_SIZE 0\n')).toThrow(/unsupported/);
  });

  it('lit la provenance dans l’en-tête écrit par le backend', () => {
    expect(readSource('# ReView display transform | source: OpenColorIO 2.4.1')).toBe('ocio');
    expect(readSource('# ReView display transform | source: built-in colorimetric')).toBe('builtin');
    expect(readSource('# some other LUT\nLUT_3D_SIZE 2')).toBe('unknown');
    expect(
      parseCubeLut(makeCube(2, identity, '# ReView display transform | source: OpenColorIO 2.4.1')).source,
    ).toBe('ocio');
  });
});

describe('cubeLut — échantillonnage', () => {
  it('une LUT identité rend la couleur d’entrée (interpolation comprise)', () => {
    const lut = parseCubeLut(makeCube(9, identity));
    for (const c of [
      [0, 0, 0],
      [1, 1, 1],
      [0.5, 0.25, 0.75],
      [0.31, 0.62, 0.11],
    ] as [number, number, number][]) {
      const out = sampleLut(lut, c);
      out.forEach((v, i) => expect(Math.abs(v - c[i])).toBeLessThan(0.01));
    }
  });

  it('une LUT qui inverse les canaux les inverse aussi à l’échantillonnage', () => {
    const lut = parseCubeLut(makeCube(5, (r, g, b) => [b, r, g]));
    const out = sampleLut(lut, [1, 0, 0.5]);
    expect(out[0]).toBeCloseTo(0.5, 2);
    expect(out[1]).toBeCloseTo(1, 2);
    expect(out[2]).toBeCloseTo(0, 2);
  });

  it('borne les entrées hors domaine plutôt que de lire hors grille', () => {
    const lut = parseCubeLut(makeCube(4, identity));
    expect(sampleLut(lut, [-1, 2, 0.5])[0]).toBeCloseTo(0, 5);
    expect(sampleLut(lut, [-1, 2, 0.5])[1]).toBeCloseTo(1, 5);
  });
});

describe('cubeLut — atlas 2D (repli WebGL1)', () => {
  it('dispose les tranches en grille la plus carrée possible', () => {
    expect(tileLayout(33)).toEqual({ cols: 6, rows: 6, width: 198, height: 198 });
    expect(tileLayout(16)).toEqual({ cols: 4, rows: 4, width: 64, height: 64 });
  });

  it('reporte chaque texel du volume dans sa tuile', () => {
    const lut = parseCubeLut(makeCube(4, (r, g, b) => [r, g, b]));
    const atlas = toTiles(lut);
    expect(atlas.data.length).toBe(atlas.width * atlas.height * 4);
    // Tranche b=2 → deuxième tuile de la première ligne (cols=2) → colonne 0, ligne 1.
    const { cols, width } = atlas;
    const b = 2;
    const ox = (b % cols) * 4;
    const oy = Math.floor(b / cols) * 4;
    const dst = ((oy + 1) * width + ox + 3) * 4; // r=3, g=1, b=2
    expect(atlas.data[dst]).toBe(255);
    expect(atlas.data[dst + 1]).toBe(85);
    expect(atlas.data[dst + 2]).toBe(170);
  });
});
