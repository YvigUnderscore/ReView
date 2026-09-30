// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { isClosed, matchesFilter, stateOf, toggleState } from './commentState';

describe('stateOf', () => {
  it('lit l’état quand il est là', () => {
    expect(stateOf({ state: 'WIP', isResolved: false })).toBe('WIP');
    expect(stateOf({ state: 'WONT_FIX', isResolved: false })).toBe('WONT_FIX');
  });

  it('retombe sur le booléen pour les commentaires antérieurs', () => {
    // Sans ce repli, tous les fils déjà résolus se rouvriraient à l'écran.
    expect(stateOf({ isResolved: true })).toBe('RESOLVED');
    expect(stateOf({ isResolved: false })).toBe('OPEN');
    expect(stateOf({ state: null, isResolved: true })).toBe('RESOLVED');
  });

  it('ignore une valeur inconnue plutôt que de l’afficher telle quelle', () => {
    expect(stateOf({ state: 'BIDON', isResolved: true })).toBe('RESOLVED');
  });
});

describe('isClosed', () => {
  it('range « ne sera pas corrigé » avec « résolu »', () => {
    expect(isClosed('RESOLVED')).toBe(true);
    expect(isClosed('WONT_FIX')).toBe(true);
  });

  it('laisse ouverts les états qui attendent encore quelque chose', () => {
    expect(isClosed('OPEN')).toBe(false);
    expect(isClosed('WIP')).toBe(false);
    expect(isClosed('QUESTION')).toBe(false);
  });
});

describe('matchesFilter', () => {
  it('laisse tout passer sans filtre', () => {
    expect(matchesFilter({ isResolved: true }, null)).toBe(true);
  });

  it('compare à l’état effectif, repli compris', () => {
    expect(matchesFilter({ isResolved: true }, 'RESOLVED')).toBe(true);
    expect(matchesFilter({ isResolved: false }, 'RESOLVED')).toBe(false);
    expect(matchesFilter({ state: 'QUESTION', isResolved: false }, 'QUESTION')).toBe(true);
  });
});

describe('toggleState', () => {
  it('résout ce qui ne l’est pas, rouvre ce qui l’est', () => {
    expect(toggleState('OPEN')).toBe('RESOLVED');
    expect(toggleState('WIP')).toBe('RESOLVED');
    expect(toggleState('RESOLVED')).toBe('OPEN');
  });
});
