// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useViewPref } from './useViewPref';

/** Remet le store et le miroir local à zéro : les tests partagent le même singleton. */
beforeEach(() => {
  localStorage.clear();
  useViewPref.setState({ modes: {}, global: null, persist: null });
});

describe('useViewPref — les deux niveaux', () => {
  it('sans rien de posé, une liste montre des cartes', () => {
    expect(useViewPref.getState().get('shots:12')).toBe('cards');
  });

  it('le réglage du compte vaut pour toutes les listes', () => {
    useViewPref.getState().setGlobal('compact');
    expect(useViewPref.getState().get('shots:12')).toBe('compact');
    expect(useViewPref.getState().get('assets:12')).toBe('compact');
  });

  it('un écart ne vaut que pour sa liste', () => {
    useViewPref.getState().setGlobal('compact');
    useViewPref.getState().set('shots:12', 'cards');
    expect(useViewPref.getState().get('shots:12')).toBe('cards');
    // Les autres listes continuent de suivre le compte : c'est tout l'objet de l'écart.
    expect(useViewPref.getState().get('assets:12')).toBe('compact');
  });

  it('lever un écart ramène la liste au réglage du compte', () => {
    useViewPref.getState().setGlobal('compact');
    useViewPref.getState().set('shots:12', 'cards');
    useViewPref.getState().clear('shots:12');
    expect(useViewPref.getState().get('shots:12')).toBe('compact');
    expect(localStorage.getItem('review:view:shots:12')).toBeNull();
  });

  it('la bascule pose un écart, elle ne touche pas au compte', () => {
    useViewPref.getState().setGlobal('cards');
    useViewPref.getState().toggle('shots:12');
    expect(useViewPref.getState().get('shots:12')).toBe('compact');
    expect(useViewPref.getState().global).toBe('cards');
  });
});

describe('useViewPref — le compte fait foi', () => {
  it("l'hydratation remplace le miroir local", () => {
    useViewPref.getState().set('shots:12', 'compact');
    useViewPref.getState().hydrate({ viewMode: 'compact', viewModes: { 'shots:12': 'cards' } });
    expect(useViewPref.getState().get('shots:12')).toBe('cards');
    expect(useViewPref.getState().get('assets:12')).toBe('compact');
  });

  it('hydrater sans rien remet les listes au repli', () => {
    useViewPref.getState().hydrate({});
    expect(useViewPref.getState().global).toBeNull();
    expect(useViewPref.getState().get('shots:12')).toBe('cards');
  });

  it('chaque écriture repart vers le serveur — sinon le réglage ne suivrait pas', () => {
    const persist = vi.fn();
    useViewPref.getState().setPersist(persist);

    useViewPref.getState().set('shots:12', 'compact');
    expect(persist).toHaveBeenLastCalledWith({ viewModes: { 'shots:12': 'compact' } });

    useViewPref.getState().setGlobal('compact');
    expect(persist).toHaveBeenLastCalledWith({ viewMode: 'compact' });

    useViewPref.getState().clear('shots:12');
    expect(persist).toHaveBeenLastCalledWith({ viewModes: {} });
  });
});

describe('useViewPref — miroir local', () => {
  it('relit le miroir quand le store est neuf (premier rendu, avant les préférences)', () => {
    localStorage.setItem('review:view:shots:12', 'compact');
    expect(useViewPref.getState().get('shots:12')).toBe('compact');
  });

  it('ignore une valeur illisible plutôt que de la prendre pour un mode', () => {
    localStorage.setItem('review:view:shots:12', 'grille');
    expect(useViewPref.getState().get('shots:12')).toBe('cards');
  });
});
