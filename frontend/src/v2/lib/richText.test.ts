// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { excerpt, stripHtml } from './richText';

describe('stripHtml', () => {
  /**
   * Le cas constaté à l'écran : une note importée de ShotGrid, affichée telle quelle par
   * l'accueil, qui montrait son balisage au lecteur.
   */
  it('rend lisible une note importée de ShotGrid', () => {
    const note =
      '<p><em>ShotGrid</em></p><p><strong>Timing</strong></p><p>The hero lands two frames late.</p>';
    expect(stripHtml(note)).toBe('ShotGrid Timing The hero lands two frames late.');
  });

  // Une balise qui disparaît sans laisser d'espace colle les mots de deux blocs.
  it('sépare les blocs au lieu de les coller', () => {
    expect(stripHtml('<p>a</p><p>b</p>')).toBe('a b');
    expect(stripHtml('un<br>deux')).toBe('un deux');
  });

  it('ne double pas l’espace quand la balise en séparait déjà', () => {
    expect(stripHtml('<p>un</p> <p>deux</p>')).toBe('un deux');
  });

  it('laisse un texte sans balise intact', () => {
    expect(stripHtml('simple')).toBe('simple');
    expect(stripHtml('')).toBe('');
  });

  it('emporte les attributs avec la balise', () => {
    expect(stripHtml('<a href="http://x" title="y">lien</a>')).toBe('lien');
  });
});

describe('excerpt', () => {
  it('laisse passer ce qui tient', () => {
    expect(excerpt('<p>court</p>', 40)).toBe('court');
  });

  it('coupe sur un mot, pas au milieu', () => {
    const long = '<p>The hero lands two frames late and nobody noticed until the review</p>';
    const rendu = excerpt(long, 30);
    expect(rendu.endsWith('…')).toBe(true);
    expect(rendu.length).toBeLessThanOrEqual(31);
    // Reculer jusqu'à l'espace : le dernier mot est entier, pas tronqué.
    expect(rendu.slice(0, -1).trim().split(' ').pop()).toMatch(/^\w+$/);
  });

  /**
   * Un mot unique plus long que la limite n'a pas d'espace où reculer : mieux vaut le couper
   * que de rendre une chaîne vide.
   */
  it('coupe quand même un mot interminable', () => {
    expect(excerpt('<p>' + 'a'.repeat(50) + '</p>', 10)).toBe('aaaaaaaaaa…');
  });
});
