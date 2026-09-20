// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  canCleanModel3d,
  model3dCleanTools,
  model3dSwitcherModes,
  model3dToolsFor,
  type Model3DCleanReach,
} from './model3dChrome';
import { canSwitchMode, switcherModesFor } from '../chrome/modes';
import { chromeCommandFor } from '../chrome/shortcuts';

/**
 * Bascule du viewer modèle 3D après le lot 6 : « Mise en scène » a quitté les segments (son
 * interrupteur vit dans le panneau Caméra) et « Nettoyer » ne s'affiche que s'il sert.
 *
 * Ce fichier vérifie aussi les deux façons de faire revenir un bouton mort par la porte de
 * service : la touche d'outil qui arme un mode absent de la bascule, et le splat, dont la
 * bascule partage le même `modes.ts` et ne doit pas bouger d'un segment.
 */

const values = (reach: Model3DCleanReach) => model3dSwitcherModes(canCleanModel3d(reach)).map((m) => m.value);

/** Le cas nu : un GLB sans scène USD, dont la seule écriture est la transformation. */
const plainGlb = (canEditTransform: boolean): Model3DCleanReach => ({
  canEditTransform,
  hasScenegraph: false,
});

describe('model3dSwitcherModes', () => {
  it('ne propose plus « Mise en scène » comme segment', () => {
    for (const can of [true, false]) expect(values(plainGlb(can))).not.toContain('stage');
  });

  it('ne propose « Nettoyer » que lorsqu’il est utilisable', () => {
    expect(values(plainGlb(true))).toEqual(['explore', 'clean']);
    expect(values(plainGlb(false))).toEqual(['explore']);
  });

  it('fait disparaître la bascule quand il ne reste qu’Explorer', () => {
    // Un segment unique ne bascule vers rien : la règle du chrome, appliquée telle quelle.
    expect(canSwitchMode('ARTIST', values(plainGlb(false)).length)).toBe(false);
    expect(canSwitchMode('ARTIST', values(plainGlb(true)).length)).toBe(true);
  });

  it('ne promet plus à « Nettoyer » des outils que le modèle n’a pas', () => {
    // L'infobulle du chrome spatial annonce « sélection, suppression, volumes de coupe,
    // transformation » : trois de ces quatre gestes sont les outils de nuage, propres au splat.
    const clean = model3dSwitcherModes(true).find((mode) => mode.value === 'clean');
    expect(clean?.hintKey).not.toBe('mode.clean.hint');
    expect(switcherModesFor('SPLAT').find((m) => m.value === 'clean')?.hintKey).toBe('mode.clean.hint');
  });

  it('laisse la bascule du splat intacte — même fichier de modes, autre viewer', () => {
    const splat = switcherModesFor('SPLAT').map((m) => m.value);
    expect(splat).toContain('stage');
    expect(splat).toContain('clean');
  });
});

describe('canCleanModel3d', () => {
  it('exige les deux : des outils ET un endroit où garder le résultat', () => {
    // Les gizmos TRS sont bien là (les outils de sélection, eux, sont propres au splat) :
    // c'est donc la destination de leur travail qui décide.
    expect(model3dCleanTools().length).toBeGreaterThan(0);
    expect(canCleanModel3d({ canEditTransform: true, hasScenegraph: false })).toBe(true);
    expect(canCleanModel3d({ canEditTransform: false, hasScenegraph: false })).toBe(false);
  });

  it('reste offert sur une scène USD sans le droit d’écrire la transformation', () => {
    // Les mêmes gizmos visent un prim et écrivent dans l'override de scène (46.N) : un delta
    // rejoué pour tous quand un gestionnaire l'enregistre, joignable à un commentaire par
    // n'importe quel relecteur. Le juger sur le seul `editTransform` supprimerait cette
    // fonctionnalité en supprimant l'onglet.
    expect(canCleanModel3d({ canEditTransform: false, hasScenegraph: true })).toBe(true);
    expect(values({ canEditTransform: false, hasScenegraph: true })).toContain('clean');
  });

  it('n’offre aucun outil de nuage de points sur un modèle', () => {
    const ids = model3dCleanTools().map((tool) => tool.id);
    for (const splatOnly of ['sel-rect', 'sel-lasso', 'sel-brush', 'volume'])
      expect(ids).not.toContain(splatOnly);
  });
});

describe('model3dToolsFor', () => {
  it('vide le rail du mode « Nettoyer » quand il est indisponible', () => {
    expect(model3dToolsFor('clean', false)).toEqual([]);
    expect(model3dToolsFor('clean', true).map((tool) => tool.id)).toContain('translate');
  });

  it('ne touche pas aux autres modes', () => {
    for (const mode of ['explore', 'annotate', 'stage'] as const)
      expect(model3dToolsFor(mode, false)).toEqual(model3dToolsFor(mode, true));
  });
});

describe('raccourcis — un mode retiré ne s’arme pas au clavier', () => {
  const press = (key: string, canClean: boolean) =>
    chromeCommandFor(key, {
      kind: 'MODEL_3D',
      mode: 'explore',
      tool: 'nav',
      modes: model3dSwitcherModes(canClean),
      toolsOf: (mode) => model3dToolsFor(mode, canClean),
    });

  it('n’envoie pas « T » dans un mode « Nettoyer » indisponible', () => {
    // Sans le droit d'enregistrer, `T` ne doit pas armer le gizmo de translation : il
    // trouve l'outil caméra de la mise en scène, qui, lui, n'enregistre rien de verrouillé.
    const command = press('t', false);
    expect(command).toEqual({ action: 'tool', mode: 'stage', tool: 'cam-move' });
  });

  it('y envoie « T » dès que le mode est offert', () => {
    expect(press('t', true)).toEqual({ action: 'tool', mode: 'clean', tool: 'translate' });
  });

  it('ne garde que la touche « 1 » en bascule de mode quand un seul segment reste', () => {
    expect(press('1', false)).toEqual({ action: 'mode', mode: 'explore' });
    expect(press('2', false)).toBeNull();
    expect(press('2', true)).toEqual({ action: 'mode', mode: 'clean' });
  });
});
