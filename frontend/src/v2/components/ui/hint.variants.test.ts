// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { hintClasses } from './hint.variants';

/**
 * La règle que porte l'aide, et la seule qui ne doit pas se perdre : **une note
 * explicative se réduit, un message d'erreur ou de confirmation jamais**. Une aide qu'on
 * ne lit pas a rempli son office ; une erreur qu'on ne lit pas fait perdre la donnée.
 */
describe('hintClasses', () => {
  it('rend la note dans le cran d’aide, atténuée', () => {
    expect(hintClasses()).toBe('text-xs text-muted-foreground');
    expect(hintClasses('muted', 'note')).toBe('text-xs text-muted-foreground');
  });

  it('descend d’un cran pour la note de bas de panneau', () => {
    expect(hintClasses('muted', 'fine')).toBe('text-2xs text-muted-foreground');
  });

  it('ne réduit JAMAIS une erreur ni une confirmation, même si on le demande', () => {
    for (const size of ['note', 'fine'] as const) {
      expect(hintClasses('error', size)).toBe('text-sm text-destructive');
      expect(hintClasses('success', size)).toBe('text-sm text-success');
    }
  });

  it('reste dans la rampe : jamais de taille en pixels', () => {
    for (const tone of ['muted', 'error', 'success'] as const) {
      for (const size of ['note', 'fine'] as const) {
        expect(hintClasses(tone, size)).not.toMatch(/\[\d+px\]/);
      }
    }
  });

  it('ne descend pas sous le plancher d’accessibilité — `text-2xs` est le dernier cran', () => {
    // `theme.a11y.test.ts` garantit que `--text-2xs` tient 11 px (10 px en compact).
    // Un cran de plus n'existe pas : il n'y a rien à écrire en dessous.
    const toutes = (['note', 'fine'] as const).map((size) => hintClasses('muted', size));
    expect(toutes.every((c) => /text-(xs|2xs)\b/.test(c))).toBe(true);
    expect(toutes.some((c) => c.includes('text-3xs'))).toBe(false);
  });
});
