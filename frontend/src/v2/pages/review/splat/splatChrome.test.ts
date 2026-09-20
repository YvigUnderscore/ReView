// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { canSwitchMode, modesFor, switcherModesFor } from '../chrome/modes';
import { reconcileChrome, defaultChromeState } from '../chrome/chromeState';
import { chromeCommandFor, type ChromeKeyContext } from '../chrome/shortcuts';
import { toolsFor } from '../chrome/tools';
import { splatEditTools, splatSwitcherModes } from './splatChrome';

/**
 * Bascule du splat (Phase 50, lot 12) : « Mise en scène » et « Nettoyer » quittent l'en-tête.
 *
 * Ce qui est vérifié ici est exactement ce que le retrait de deux segments doit préserver —
 * les modes restent valides, tous leurs outils restent au rail et au clavier, et aucune lettre
 * ne devient orpheline. C'est le défaut que le lot 4 avait soldé (un outil retiré du rail qui
 * s'armait quand même) ; il ne se rouvre pas par la bascule.
 */

/** Contexte de frappe d'un viewer splat : le rail complet, la bascule réellement offerte. */
const ctx = (mode: ChromeKeyContext['mode'] = 'explore'): ChromeKeyContext => ({
  kind: 'SPLAT',
  mode,
  tool: 'nav',
  modes: splatSwitcherModes(),
  toolsOf: (m) => toolsFor(m, 'SPLAT'),
});

describe('splatSwitcherModes — la bascule du splat s’efface', () => {
  it('ne propose plus « Mise en scène » ni « Nettoyer »', () => {
    const values = splatSwitcherModes().map((m) => m.value);
    expect(values).not.toContain('stage');
    expect(values).not.toContain('clean');
    // Le chrome spatial commun, lui, les connaît toujours : c'est le splat qui s'en écarte.
    expect(switcherModesFor('SPLAT').map((m) => m.value)).toContain('clean');
  });

  it('n’a plus qu’« Explorer » — un segment unique ne bascule vers rien', () => {
    expect(splatSwitcherModes().map((m) => m.value)).toEqual(['explore']);
    expect(canSwitchMode('ADMIN', splatSwitcherModes().length)).toBe(false);
  });

  it('laisse les deux modes VALIDES : rien n’est supprimé, seul le chemin change', () => {
    // `reconcileChrome` juge sur la liste complète : un outil d'édition armé y reste armé,
    // sinon le retrait du segment aurait emporté l'outil avec lui.
    expect(modesFor('SPLAT').map((m) => m.value)).toEqual(
      expect.arrayContaining(['stage', 'clean', 'annotate']),
    );
    const state = { ...defaultChromeState(), mode: 'clean' as const, tool: 'sel-lasso' as const };
    expect(reconcileChrome(state, 'SPLAT')).toBe(state);
  });

  it('retire les deux segments des touches numériques — un segment absent ne s’arme pas', () => {
    expect(chromeCommandFor('1', ctx())).toEqual({ action: 'mode', mode: 'explore' });
    expect(chromeCommandFor('2', ctx())).toBeNull();
    expect(chromeCommandFor('3', ctx())).toBeNull();
  });
});

describe('splatEditTools — les outils d’édition passent sur le viewer, pas à la trappe', () => {
  it('liste les outils du mode « Nettoyer », hors état de repos', () => {
    expect(splatEditTools().map((tool) => tool.id)).toEqual([
      'sel-rect',
      'sel-lasso',
      'sel-brush',
      'volume',
      'translate',
      'rotate',
      'scale',
    ]);
    expect(splatEditTools().map((tool) => tool.id)).not.toContain('nav');
  });

  it('chacun garde sa lettre, depuis l’exploration comme depuis l’édition', () => {
    for (const tool of splatEditTools())
      for (const mode of ['explore', 'clean'] as const)
        expect(chromeCommandFor(tool.key, ctx(mode))).toEqual({
          action: 'tool',
          mode: 'clean',
          tool: tool.id,
        });
  });

  it('n’oublie aucun outil armable : pas de lettre orpheline au popover', () => {
    // L'inverse du test précédent : tout ce que le clavier peut armer dans « Nettoyer » doit
    // se trouver à la souris. Un outil au clavier sans bouton est exactement le défaut qu'on
    // se refuse à rouvrir, dans l'autre sens.
    const shown = new Set(splatEditTools().map((tool) => tool.id));
    for (const tool of toolsFor('clean', 'SPLAT'))
      if (tool.id !== 'nav') expect(shown.has(tool.id)).toBe(true);
  });
});
