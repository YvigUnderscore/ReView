// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { buttonVariants } from './button.variants';

/** L'ordre des classes n'a pas de sens en CSS : on compare des ensembles. */
const set = (value: string) => new Set(value.split(/\s+/).filter(Boolean));

const VARIANTS = ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'] as const;

describe('buttonVariants — lisibilité de la variante sans aplat', () => {
  /*
   * Le grief d'origine : `outline` posait `bg-transparent` sur `border-border`, un trait
   * décoratif à 1,17:1 en thème sombre. Le bouton existait sans se voir. La correction
   * n'est pas cosmétique — elle tient à un token précis, dont `theme.a11y.test.ts` vérifie
   * par ailleurs qu'il atteint bien 3:1. Ce test-ci verrouille l'autre moitié : que la
   * variante consomme ce token et pas le décoratif.
   */
  it('la variante outline dessine sa bordure avec le token des contrôles', () => {
    const classes = set(buttonVariants({ variant: 'outline' }));
    expect(classes.has('border-border-strong')).toBe(true);
    expect(classes.has('border-border')).toBe(false);
  });

  it('aucune autre variante ne s’approprie le token des contrôles', () => {
    for (const variant of VARIANTS.filter((name) => name !== 'outline')) {
      expect(set(buttonVariants({ variant })).has('border-border-strong'), variant).toBe(false);
    }
  });
});

describe('buttonVariants — état enfoncé', () => {
  /*
   * L'enfoncement géométrique est commun à tous les contrôles : il est écrit une fois dans
   * la base du `cva` (et défini dans index.css), jamais recopié par variante.
   */
  it('pose ui-pressable sur toutes les variantes, sans le répéter', () => {
    for (const variant of VARIANTS) {
      const classes = buttonVariants({ variant })
        .split(/\s+/)
        .filter((c) => c === 'ui-pressable');
      expect(classes, variant).toHaveLength(1);
    }
  });

  /*
   * Un survol sans état enfoncé, c'est un clic qui ne se voit pas : sur une action lente,
   * rien ne distingue « parti » de « pas pris ». Chaque variante qui réagit au survol doit
   * donc réagir aussi à l'appui.
   */
  it('donne à chaque variante un état :active distinct de son survol', () => {
    for (const variant of VARIANTS) {
      const classes = [...set(buttonVariants({ variant }))];
      const hover = classes.filter((c) => c.startsWith('hover:'));
      const active = classes.filter((c) => c.startsWith('active:'));
      expect(hover.length, `${variant} : survol`).toBeGreaterThan(0);
      expect(active.length, `${variant} : appui`).toBeGreaterThan(0);
      // L'appui ne redit pas le survol : il pousse la même propriété un cran plus loin.
      const strip = (prefix: string) => (c: string) => c.slice(prefix.length);
      expect(
        active.map(strip('active:')).some((c) => !hover.map(strip('hover:')).includes(c)),
        `${variant} : l’appui doit différer du survol`,
      ).toBe(true);
    }
  });
});

describe('buttonVariants — non-régression de forme', () => {
  /*
   * Le refactoring déplace le `cva` dans son propre module : la sortie doit rester
   * identique au caractère près pour la variante par défaut, la plus employée.
   */
  it('rend le bouton par défaut inchangé', () => {
    expect(set(buttonVariants())).toEqual(
      set(
        'ui-pressable inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-medium' +
          ' transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none' +
          ' focus-visible:ring-2 focus-visible:ring-ring bg-primary text-primary-foreground' +
          ' hover:bg-primary/90 active:bg-primary/80 px-4 py-2',
      ),
    );
  });

  it('conserve les quatre tailles', () => {
    expect(set(buttonVariants({ size: 'sm' })).has('text-xs')).toBe(true);
    expect(set(buttonVariants({ size: 'lg' })).has('text-base')).toBe(true);
    expect(set(buttonVariants({ size: 'icon' })).has('h-8')).toBe(true);
    expect(set(buttonVariants({ size: 'default' })).has('px-4')).toBe(true);
  });
});
