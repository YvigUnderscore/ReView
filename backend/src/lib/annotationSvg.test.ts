// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { annotationToSvg, parseShapes } from './annotationSvg';

/**
 * Les annotations sont stockées en coordonnées relatives pour suivre l'affichage.
 * Le rendu doit les replacer exactement là où l'artiste les a tracées — un repère
 * décalé désigne le mauvais endroit de l'image, ce qui est pire que pas de repère.
 */
describe('parseShapes', () => {
  it('accepte les deux formes de stockage', () => {
    expect(parseShapes([{ type: 'rect' }])).toHaveLength(1);
    expect(parseShapes({ shapes: [{ type: 'rect' }, { type: 'arrow' }] })).toHaveLength(2);
  });

  it('écarte ce qui n’est pas une forme', () => {
    expect(parseShapes(null)).toEqual([]);
    expect(parseShapes('cassé')).toEqual([]);
    expect(parseShapes([null, { pas: 'un type' }])).toEqual([]);
  });
});

describe('annotationToSvg', () => {
  it('replace un rectangle relatif aux dimensions du média', () => {
    const svg = annotationToSvg([{ type: 'rect', x: 0.5, y: 0.25, w: 0.25, h: 0.5 }], 1920, 1080);
    expect(svg).toContain('x="960"');
    expect(svg).toContain('y="270"');
    expect(svg).toContain('width="480"');
    expect(svg).toContain('height="540"');
  });

  it('trace un chemin libre point par point', () => {
    const svg = annotationToSvg(
      [
        {
          type: 'path',
          pts: [
            [0, 0],
            [0.5, 0.5],
            [1, 1],
          ],
        },
      ],
      1000,
      500,
    );
    expect(svg).toContain('M 0,0 L 500,250 L 1000,500');
  });

  it('dessine la pointe de la flèche plutôt que d’en confier le rendu au convertisseur', () => {
    // Un marqueur SVG perd sa couleur — et souvent sa tête — à la conversion.
    const svg = annotationToSvg([{ type: 'arrow', x1: 0, y1: 0, x2: 1, y2: 0 }], 800, 600);
    expect(svg).toContain('<line');
    expect(svg).toContain('<polygon');
  });

  it('donne un document aux dimensions demandées', () => {
    const svg = annotationToSvg([{ type: 'ellipse', cx: 0.5, cy: 0.5, rx: 0.1, ry: 0.1 }], 640, 360);
    expect(svg).toContain('width="640"');
    expect(svg).toContain('viewBox="0 0 640 360"');
  });

  it('ne compose rien quand il n’y a rien à montrer', () => {
    expect(annotationToSvg([], 1920, 1080)).toBeNull();
    expect(annotationToSvg(null, 1920, 1080)).toBeNull();
    expect(annotationToSvg([{ type: 'path', pts: [[0, 0]] }], 100, 100)).toBeNull();
  });

  it('échappe le texte pour rester un document valide', () => {
    const svg = annotationToSvg([{ type: 'text', x: 0.1, y: 0.1, text: 'a < b & "c"' }], 100, 100);
    expect(svg).toContain('a &lt; b &amp; &quot;c&quot;');
    expect(svg).not.toContain('a < b &');
  });
});
