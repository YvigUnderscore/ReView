// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  TOOLTIP_DELAY_MS,
  TOOLTIP_SKIP_DELAY_MS,
  shouldRenderTooltip,
  tooltipContentClass,
} from './tooltip.variants';

/** L'ordre des classes n'a pas de sens en CSS : on compare des ensembles. */
const set = (value: string) => new Set(value.split(/\s+/).filter(Boolean));

describe('tooltipContentClass — empilement', () => {
  /*
   * Le piège qui a motivé ce test : tous les calques flottants du dossier sont à `z-50`.
   * Une infobulle déclenchée depuis l'en-tête d'une modale est portalisée sur `body`, comme
   * la modale ; à égalité de `z-index`, c'est l'ordre du DOM qui tranche, donc l'ordre de
   * montage. Un cran au-dessus rend le rendu déterministe.
   */
  it('se place au-dessus des calques à z-50 (dialog, sheet, popover, menu contextuel)', () => {
    const classes = set(tooltipContentClass());
    expect(classes.has('z-[60]')).toBe(true);
    expect(classes.has('z-50')).toBe(false);
  });
});

describe('tooltipContentClass — animation', () => {
  /*
   * Radix Tooltip n'écrit pas `open` dans son `data-state` : il écrit `delayed-open` ou
   * `instant-open`. Recopier les classes du popover (`data-[state=open]:…`) donne un
   * panneau qui n'anime jamais son entrée — et le défaut est invisible en relecture, d'où
   * ce verrou.
   */
  it('couvre les deux états d’ouverture propres à Radix Tooltip', () => {
    const value = tooltipContentClass();
    for (const state of ['delayed-open', 'instant-open']) {
      expect(value, state).toContain(`data-[state=${state}]:animate-in`);
      expect(value, state).toContain(`data-[state=${state}]:fade-in-0`);
    }
  });

  it('n’emploie pas l’état `open`, que ce primitif ne produit jamais', () => {
    expect(tooltipContentClass()).not.toContain('data-[state=open]');
  });

  it('anime aussi la fermeture', () => {
    const value = tooltipContentClass();
    expect(value).toContain('data-[state=closed]:animate-out');
    expect(value).toContain('data-[state=closed]:fade-out-0');
  });
});

describe('tooltipContentClass — thème', () => {
  /*
   * `check-color-tokens.mjs` couvre déjà le dépôt, mais il lit des fichiers : la
   * composition passe par `cn()` et mérite son propre filet, la primitive étant destinée à
   * être surchargée par ses appelants.
   */
  it('ne peint qu’avec des tokens du thème', () => {
    const classes = [...set(tooltipContentClass())];
    const painted = classes.filter((name) => /^(bg|text|border)-/.test(name));
    expect(painted).toEqual(expect.arrayContaining(['bg-card', 'text-card-foreground', 'border-border']));
    for (const name of painted) {
      // Aucune couleur brute de la palette Tailwind, reconnaissable à son échelon
      // numérique final. L'exemple n'est pas écrit en toutes lettres : `check-color-tokens`
      // lit ce fichier comme les autres et signalerait la classe citée en commentaire.
      expect(name, name).not.toMatch(/-(50|[1-9]00)$/);
    }
  });

  it('ne fixe aucune taille de texte en pixels', () => {
    expect(tooltipContentClass()).not.toMatch(/text-\[\d/);
  });
});

describe('tooltipContentClass — surcharge', () => {
  it('laisse l’appelant remplacer une classe plutôt que l’empiler', () => {
    // `cn()` s'appuie sur tailwind-merge : la dernière largeur gagne, elle ne s'ajoute pas.
    const classes = set(tooltipContentClass('max-w-sm'));
    expect(classes.has('max-w-sm')).toBe(true);
    expect(classes.has('max-w-xs')).toBe(false);
  });

  it('sans surcharge, rend une chaîne stable et non vide', () => {
    expect(tooltipContentClass()).toBe(tooltipContentClass(undefined));
    expect(tooltipContentClass().length).toBeGreaterThan(0);
  });
});

describe('shouldRenderTooltip', () => {
  /*
   * Les appelants transmettent des libellés optionnels (raccourci, libellé calculé). Sans
   * ce filtre, une chaîne vide ouvre au survol un panneau bordé et vide — un défaut visible
   * mais difficile à rattacher à sa cause.
   */
  it('ne monte rien pour un libellé absent ou vide', () => {
    for (const label of [undefined, null, false, '', '   ', '\n\t']) {
      expect(shouldRenderTooltip(label), JSON.stringify(label)).toBe(false);
    }
  });

  it('monte l’infobulle dès qu’il y a quelque chose à lire', () => {
    for (const label of ['Play', ' Play ', 0, { type: 'span' }]) {
      expect(shouldRenderTooltip(label), JSON.stringify(label)).toBe(true);
    }
  });
});

describe('délais', () => {
  /*
   * Le grief d'origine est chiffré : l'infobulle native attend ~1,5 s. Un réglage qui
   * s'en approcherait reproduirait le défaut qu'on corrige — le test borne l'intention,
   * pas la valeur exacte (250 ms), qui reste un choix de produit ajustable.
   */
  const NATIVE_TITLE_DELAY_MS = 1500;

  it('ouvre nettement plus vite que l’infobulle native du navigateur', () => {
    expect(TOOLTIP_DELAY_MS).toBeLessThan(NATIVE_TITLE_DELAY_MS / 3);
  });

  it('garde un délai non nul, pour ne pas clignoter au survol de passage', () => {
    expect(TOOLTIP_DELAY_MS).toBeGreaterThanOrEqual(150);
  });

  it('laisse la fenêtre de grâce dépasser le délai, sinon elle ne sert à rien', () => {
    // En deçà, parcourir une barre dense repaierait le délai à chaque icône.
    expect(TOOLTIP_SKIP_DELAY_MS).toBeGreaterThan(TOOLTIP_DELAY_MS);
  });
});
