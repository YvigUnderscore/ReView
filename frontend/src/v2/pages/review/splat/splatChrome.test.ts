// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { canSwitchMode, modesFor, switcherModesFor } from '../chrome/modes';
import { reconcileChrome, defaultChromeState } from '../chrome/chromeState';
import { chromeCommandFor, type ChromeKeyContext } from '../chrome/shortcuts';
import { DEFAULT_TOOL, toolsFor } from '../chrome/tools';
import { hasMessage } from '../../../i18n';
import { splatEditRail, splatEditTools, splatSwitcherModes, splatToolsFor } from './splatChrome';

/**
 * Bascule et rail du splat. « Mise en scène » et « Nettoyer » ont quitté l'en-tête au lot 12 ;
 * au lot 13, les outils d'édition **reviennent au rail** (ils avaient fini dans un popover du
 * viewer, alors que la demande était de retirer le segment, pas de ranger les outils).
 *
 * Ce qui est vérifié ici est exactement ce que ces deux mouvements doivent préserver : les modes
 * restent valides, tous leurs outils restent atteignables à la souris ET au clavier, et aucune
 * lettre ne devient orpheline. C'est le défaut que le lot 4 avait soldé (un outil retiré du rail
 * qui s'armait quand même) ; il ne se rouvre ni par la bascule, ni par le rail.
 */

/** Contexte de frappe d'un viewer splat : le rail réellement offert, éditeur monté ou non. */
const ctx = (mode: ChromeKeyContext['mode'] = 'explore', showEdit = true): ChromeKeyContext => ({
  kind: 'SPLAT',
  mode,
  tool: 'nav',
  modes: splatSwitcherModes(),
  toolsOf: (m) => splatToolsFor(m, showEdit),
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

describe('splatEditTools — les outils d’édition reviennent au rail, pas à la trappe', () => {
  it('liste les outils du mode « Nettoyer », hors état de repos', () => {
    const ids = splatEditTools().map((tool) => tool.id);
    // Sélectionner, supprimer (par le masque), déplacer, mettre à l'échelle : la demande.
    expect(ids).toEqual(['sel-rect', 'sel-lasso', 'sel-brush', 'volume', 'translate', 'rotate', 'scale']);
    expect(ids).not.toContain(DEFAULT_TOOL);
    for (const tool of splatEditTools()) expect(hasMessage(tool.labelKey)).toBe(true);
  });

  it('ne recopie rien : c’est la liste de `toolsFor`, moins le repos', () => {
    expect(splatEditTools()).toEqual(toolsFor('clean', 'SPLAT').filter((t) => t.id !== DEFAULT_TOOL));
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

  it('n’oublie aucun outil armable : pas de lettre orpheline hors du rail', () => {
    // L'inverse du test précédent : tout ce que le clavier peut armer dans « Nettoyer » doit
    // se trouver à la souris. Un outil au clavier sans bouton est exactement le défaut qu'on
    // se refuse à rouvrir, dans l'autre sens.
    const shown = new Set(splatEditTools().map((tool) => tool.id));
    for (const tool of toolsFor('clean', 'SPLAT'))
      if (tool.id !== DEFAULT_TOOL) expect(shown.has(tool.id)).toBe(true);
  });
});

describe('splatEditRail — le second groupe du rail', () => {
  it('arme « Nettoyer » et porte le titre qu’avait le popover', () => {
    const rail = splatEditRail(true)!;
    expect(rail.mode).toBe('clean');
    expect(rail.titleKey).toBe('viewer.edit.title');
    expect(hasMessage(rail.titleKey)).toBe(true);
    expect(rail.tools).toEqual(splatEditTools());
  });

  it('n’existe pas sans éditeur monté — ces outils n’écriraient nulle part', () => {
    expect(splatEditRail(false)).toBeUndefined();
  });
});

describe('splatToolsFor — le rail et le clavier lisent la même liste', () => {
  it('rend le rail du mode demandé', () => {
    expect(splatToolsFor('explore', true)).toEqual(toolsFor('explore', 'SPLAT'));
    expect(splatToolsFor('annotate', false)).toEqual(toolsFor('annotate', 'SPLAT'));
  });

  it('ferme « Nettoyer » au CLAVIER quand le groupe du rail a disparu', () => {
    // La moitié qui manquait : sans elle, `B`/`L`/`T`… armaient encore des outils que plus rien
    // ne montrait, et qui n'écrivent nulle part.
    expect(splatToolsFor('clean', false)).toEqual([]);
    expect(splatToolsFor('clean', true).length).toBeGreaterThan(1);
    for (const tool of splatEditTools())
      expect(chromeCommandFor(tool.key, ctx('explore', false))).not.toEqual(
        expect.objectContaining({ mode: 'clean' }),
      );
  });

  it('laisse la brosse de surface intacte sans éditeur : elle annote, elle n’édite pas', () => {
    expect(chromeCommandFor('p', ctx('explore', false))).toEqual({
      action: 'tool',
      mode: 'annotate',
      tool: 'paint',
    });
  });
});
