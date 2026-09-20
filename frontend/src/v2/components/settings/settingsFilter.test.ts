// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { fold, haystack, matchesQuery } from './settingsFilter';

/**
 * Le moteur commun aux trois familles de réglages — studio, projet, profil. Il vivait dans
 * l'administration seule : un projet et un profil posent pourtant la même question, « où
 * règle-t-on ça ».
 */
describe('fold', () => {
  it('replie accents et casse', () => {
    expect(fold('Éléments Masqués')).toBe('elements masques');
  });
});

describe('haystack', () => {
  it('assemble titre, aide et mots-clés en un seul texte replié', () => {
    const hay = haystack(['Burn-ins', 'Template studio', undefined, 'filigrane', 'watermark']);
    expect(hay).toBe('burn-ins template studio filigrane watermark');
  });

  it('écarte les parties absentes plutôt que d’y laisser des trous', () => {
    expect(haystack([undefined, 'Avatar', undefined])).toBe('avatar');
  });
});

describe('matchesQuery', () => {
  const hay = haystack(['Burn-ins', 'filigrane', 'watermark', 'slate']);

  it('trouve par un mot qu’on emploie vraiment, pas par le titre', () => {
    expect(matchesQuery(hay, 'filigrane')).toBe(true);
    expect(matchesQuery(hay, 'SLATE')).toBe(true);
  });

  it('ignore accents et casse', () => {
    expect(matchesQuery(haystack(['Rétention']), 'retention')).toBe(true);
    expect(matchesQuery(haystack(['Retention']), 'RÉTENTION')).toBe(true);
  });

  it('exige tous les mots : « quota slack » ne rend pas la moitié de l’écran', () => {
    expect(matchesQuery(hay, 'watermark slate')).toBe(true);
    expect(matchesQuery(hay, 'watermark quota')).toBe(false);
  });

  it('laisse tout passer quand la recherche est vide', () => {
    expect(matchesQuery(hay, '')).toBe(true);
    expect(matchesQuery(hay, '   ')).toBe(true);
  });

  it('ne trouve rien sur un mot absent — le message « aucun réglage » doit pouvoir sortir', () => {
    expect(matchesQuery(hay, 'zzzz')).toBe(false);
  });
});
