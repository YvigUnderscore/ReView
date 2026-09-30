// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { resolveQueryPhase, type QueryPhase, type QuerySnapshot } from './query-state.helpers';

/** Raccourci : un état au repos, sans donnée ni erreur — le chargement initial. */
const snap = (over: Partial<QuerySnapshot> = {}): QuerySnapshot => ({
  isError: false,
  hasData: false,
  ...over,
});

describe('resolveQueryPhase — arbitrage des états de requête (admin)', () => {
  it('montre le squelette tant que rien ne répond', () => {
    expect(resolveQueryPhase(snap())).toBe('pending');
  });

  it('montre le contenu dès que des données sont en main', () => {
    expect(resolveQueryPhase(snap({ hasData: true }))).toBe('ready');
  });

  it("montre l'échec quand le serveur a refusé et qu'il n'y a rien à afficher", () => {
    // Le défaut corrigé : ce cas rendait un squelette qui pulsait indéfiniment.
    expect(resolveQueryPhase(snap({ isError: true }))).toBe('error');
  });

  it('garde le contenu déjà affiché quand un rafraîchissement échoue', () => {
    // Cas des listes paginées (keepPreviousData) : effacer l'écran serait une régression.
    expect(resolveQueryPhase(snap({ isError: true, hasData: true }))).toBe('ready');
  });

  it('ne renvoie jamais autre chose que les trois phases connues', () => {
    const phases: QueryPhase[] = ['pending', 'error', 'ready'];
    for (const isError of [false, true])
      for (const hasData of [false, true]) expect(phases).toContain(resolveQueryPhase({ isError, hasData }));
  });
});
