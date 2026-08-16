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

/**
 * L'épaisseur est le seul champ d'une forme qui ne soit PAS normalisé : le viewer la
 * stocke en pixels écran (`vector-effect: non-scaling-stroke`). L'avoir lue comme une
 * fraction de la largeur donnait un trait de 2217 px sur une image de 739 : la frame
 * entière recouverte d'un aplat, et une note ShotGrid où l'on ne voyait « que la
 * couleur ». Ces tests fixent l'unité, faute de quoi la confusion peut revenir.
 */
describe('annotationToSvg — épaisseur en pixels écran', () => {
  const strokeOf = (svg: string | null): number =>
    Number(/stroke-width="([\d.]+)"/.exec(svg ?? '')?.[1] ?? NaN);

  const trait = (width: number | undefined, w: number, h: number) =>
    annotationToSvg(
      [
        {
          type: 'path',
          width,
          pts: [
            [0, 0],
            [1, 1],
          ],
        },
      ],
      w,
      h,
    );

  it('reste un trait, jamais un aplat', () => {
    // Le cas exact rapporté : pinceau à 3, image de 739 × 686.
    const sw = strokeOf(trait(3, 739, 686));
    expect(sw).toBeLessThan(739 * 0.01);
    expect(sw).toBeGreaterThan(0);
  });

  it('grossit avec l’image, pour garder la finesse qu’il avait à l’écran', () => {
    const petit = strokeOf(trait(3, 640, 360));
    const grand = strokeOf(trait(3, 3840, 2160));
    expect(grand).toBeGreaterThan(petit);
    expect(grand / petit).toBeCloseTo(6, 1);
  });

  it('épaissit quand l’artiste a choisi un pinceau plus large', () => {
    expect(strokeOf(trait(12, 1280, 720))).toBeCloseTo(4 * strokeOf(trait(3, 1280, 720)), 5);
  });

  it('rend l’épaisseur nominale à la largeur de référence', () => {
    expect(strokeOf(trait(3, 1280, 720))).toBeCloseTo(3, 5);
  });

  it('reste visible sur une vignette', () => {
    expect(strokeOf(trait(1, 160, 90))).toBeGreaterThanOrEqual(1);
  });

  it('prend l’épaisseur du viewer quand la forme n’en porte pas', () => {
    expect(strokeOf(trait(undefined, 1280, 720))).toBeCloseTo(3, 5);
  });
});

describe('annotationToSvg — géométrie dérivée de l’épaisseur', () => {
  it('donne au texte la taille que le viewer lui donne', () => {
    // Même formule que `textFontSize` côté front : 0.02 + width × 0.005, en fraction
    // de la HAUTEUR. Sur 1000 px de haut avec un pinceau à 4 : 40 + 20 = 40 px.
    const svg = annotationToSvg([{ type: 'text', x: 0.1, y: 0.1, width: 4, text: 'a' }], 1000, 1000);
    expect(svg).toContain('font-size="40"');
  });

  it('ne laisse pas la pointe dévorer une flèche courte', () => {
    // Trait de 20 px : la tête est bornée à 45 % de sa longueur, pas à 3,5 × l'épaisseur.
    const svg = annotationToSvg(
      [{ type: 'arrow', x1: 0.5, y1: 0.5, x2: 0.52, y2: 0.5, width: 12 }],
      1000,
      1000,
    );
    const pointe = /points="([^"]+)"/.exec(svg ?? '')?.[1] ?? '';
    const xs = pointe.split(' ').map((p) => Number(p.split(',')[0]));
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(20 * 0.45 + 0.001);
  });

  it('ignore une flèche sans longueur plutôt que de diviser par zéro', () => {
    expect(annotationToSvg([{ type: 'arrow', x1: 0.5, y1: 0.5, x2: 0.5, y2: 0.5 }], 800, 600)).toBeNull();
  });
});
