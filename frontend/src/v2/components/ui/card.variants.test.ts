// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { cn } from '../../lib/utils';
import { cardVariants } from './card.variants';

/** L'ordre des classes n'a pas de sens en CSS : on compare des ensembles. */
const set = (value: string) => new Set(value.split(/\s+/).filter(Boolean));

describe('cardVariants', () => {
  /*
   * Ces deux cas sont le contrat du refactoring : la primitive doit rendre *exactement*
   * ce que les panneaux dessinaient à la main. Si quelqu'un retouche l'échelle, ces
   * assertions tombent avant que l'écran ne change.
   */
  it('rend le panneau de réglages à l’identique du motif recopié dans les écrans', () => {
    expect(set(cardVariants())).toEqual(
      set('rounded-lg border border-border bg-card text-card-foreground p-4'),
    );
  });

  it('rend le panneau large à l’identique du motif en p-5', () => {
    expect(set(cardVariants({ padding: 'lg' }))).toEqual(
      set('rounded-lg border border-border bg-card text-card-foreground p-5'),
    );
  });

  it('rend la tuile cliquable à l’identique du motif de navigation', () => {
    expect(set(cn(cardVariants({ interactive: true }), 'block hover:bg-secondary/40'))).toEqual(
      set(
        'block rounded-lg border border-border bg-card text-card-foreground p-4 transition-colors hover:border-primary hover:bg-secondary/40',
      ),
    );
  });

  it('rend la ligne de liste à l’identique du motif compact', () => {
    expect(set(cardVariants({ variant: 'row' }))).toEqual(
      set('rounded-md border border-border bg-card text-card-foreground px-3 py-2'),
    );
  });

  it('donne au panneau une marge uniforme et à la ligne une marge horizontale', () => {
    expect(cardVariants({ padding: 'sm' })).toContain('p-3');
    expect(cardVariants({ padding: 'lg' })).toContain('p-5');
    expect(cardVariants({ variant: 'row', padding: 'sm' })).toContain('px-3 py-1.5');
    expect(cardVariants({ variant: 'row', padding: 'lg' })).toContain('px-4 py-3');
  });

  it('n’ajoute aucune marge en padding="none", pour laisser faire les sous-composants', () => {
    for (const variant of ['panel', 'row'] as const) {
      const classes = [...set(cardVariants({ variant, padding: 'none' }))];
      expect(classes.filter((c) => /^p[xy]?-/.test(c))).toEqual([]);
    }
  });

  it('n’attache le survol qu’aux cartes déclarées cliquables', () => {
    expect(cardVariants()).not.toContain('hover:');
    expect(cardVariants({ interactive: true })).toContain('transition-colors hover:border-primary');
  });

  it('n’emploie que des tokens de thème, jamais une couleur Tailwind brute', () => {
    const every = (['panel', 'row'] as const).flatMap((variant) =>
      (['none', 'sm', 'md', 'lg'] as const).map((padding) =>
        cardVariants({ variant, padding, interactive: true }),
      ),
    );
    // Une couleur Tailwind brute se reconnaît à sa graduation numérique après la teinte
    // (fond, texte ou bordure suivis d'un nom de teinte puis d'un nombre) ; un token du
    // thème n'en a jamais.
    expect(every.join(' ')).not.toMatch(/\b(?:bg|text|border)-[a-z]+-\d{2,3}\b/);
  });

  it('laisse l’appelant remplacer la marge par la sienne', () => {
    // Les sites de conversion passent leur propre espacement ; twMerge doit trancher.
    const classes = set(cn(cardVariants(), 'p-6'));
    expect(classes.has('p-6')).toBe(true);
    expect(classes.has('p-4')).toBe(false);
  });
});
