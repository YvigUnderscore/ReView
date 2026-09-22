// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { hasMessage } from '../../../i18n';
import { modesFor, switcherModesFor, type ModeId } from './modes';
import { toolsFor, viewActionsFor } from './tools';
import {
  NEUTRAL_KEY_NAMES,
  chromeCommandFor,
  reviewShortcutGroups,
  type ChromeKeyContext,
  type KeyToken,
} from './shortcuts';
import type { MediaKind } from '../../../types/api';

const KINDS: MediaKind[] = ['VIDEO', 'IMAGE', 'MODEL_3D', 'SPLAT'];

/** Contexte de frappe d'un viewer de review : le rail complet du type de média. */
const ctx = (kind: MediaKind, mode: ModeId = 'explore', tool = 'nav'): ChromeKeyContext => ({
  kind,
  mode,
  tool: tool as ChromeKeyContext['tool'],
  modes: switcherModesFor(kind),
  toolsOf: (m) => toolsFor(m, kind),
});

describe('chromeCommandFor — une frappe, une commande', () => {
  it('Tab bascule le dock, Échap ne répond que s’il y a un outil à désarmer', () => {
    expect(chromeCommandFor('Tab', ctx('VIDEO'))).toEqual({ action: 'panel' });
    expect(chromeCommandFor('Escape', ctx('VIDEO'))).toBeNull();
    expect(chromeCommandFor('Escape', ctx('VIDEO', 'annotate', 'draw'))).toEqual({ action: 'rest' });
  });

  it('les chiffres suivent la bascule de mode, et s’arrêtent avec elle', () => {
    const modes = switcherModesFor('VIDEO');
    expect(chromeCommandFor('1', ctx('VIDEO'))).toEqual({ action: 'mode', mode: modes[0].value });
    expect(chromeCommandFor('2', ctx('VIDEO'))).toEqual({ action: 'mode', mode: modes[1].value });
    // Deux modes en vidéo : le troisième chiffre ne s'arme sur rien.
    expect(chromeCommandFor('3', ctx('VIDEO'))).toBeNull();
    expect(chromeCommandFor('0', ctx('VIDEO'))).toBeNull();
  });

  it('une lettre d’outil bascule vers le mode qui le porte', () => {
    expect(chromeCommandFor('d', ctx('VIDEO'))).toEqual({ action: 'tool', mode: 'annotate', tool: 'draw' });
    expect(chromeCommandFor('T', ctx('SPLAT'))).toEqual({ action: 'tool', mode: 'clean', tool: 'translate' });
  });

  /**
   * `G` armait le polygone ET amorçait la séquence de navigation globale (`g` puis une lettre).
   * Le leader n'étant pas reconfigurable, l'outil a changé de touche : `G` ne doit plus rien
   * armer dans aucun viewer.
   */
  it('G n’arme plus aucun outil : la touche appartient au leader de navigation', () => {
    for (const kind of KINDS)
      for (const mode of modesFor(kind)) expect(chromeCommandFor('g', ctx(kind, mode.value))).toBeNull();
    expect(chromeCommandFor('p', ctx('VIDEO'))).toEqual({
      action: 'tool',
      mode: 'annotate',
      tool: 'polygon',
    });
  });

  it('les outils supprimés ne sont plus armables au clavier', () => {
    // « Zoom » (Z) sur les médias plats, « Région » (B) en 3D : masqués du rail par tous les
    // viewers, donc sans implémentation — et pourtant armables au clavier.
    for (const kind of ['VIDEO', 'IMAGE'] as const) expect(chromeCommandFor('z', ctx(kind))).toBeNull();
    // « Barre de wipe » (W) : le mode « Compare » arme déjà le wipe, l'outil redisait le mode
    // depuis le rail sans rien armer de plus. La touche ne doit donc plus rien atteindre,
    // depuis aucun mode — c'est exactement le défaut que le registre a soldé.
    for (const kind of ['VIDEO', 'IMAGE'] as const)
      for (const mode of modesFor(kind)) expect(chromeCommandFor('w', ctx(kind, mode.value))).toBeNull();
    expect(chromeCommandFor('b', ctx('MODEL_3D'))).toBeNull();
    // Le splat garde sa sélection rectangle sur la même lettre.
    expect(chromeCommandFor('b', ctx('SPLAT'))).toEqual({
      action: 'tool',
      mode: 'clean',
      tool: 'sel-rect',
    });
  });

  /**
   * RÉÉCRIT en connaissance de cause (Phase 50, lot 13). Le cas précédent verrouillait
   * « le painter 3D reste au splat » — la restriction `kind: 'SPLAT'` posée au lot 8, alors que
   * la demande disait « dans les outils d'annotation 3D/splat ». Elle n'a donc jamais fermé un
   * trou : elle a acté un manque, et sur un modèle le mode « Annoter » n'offrait que la
   * navigation et l'épingle. La brosse et sa gomme servent maintenant les deux types spatiaux.
   */
  it('la brosse de surface et sa gomme s’arment sur les DEUX types spatiaux', () => {
    for (const kind of ['SPLAT', 'MODEL_3D'] as const) {
      expect(chromeCommandFor('p', ctx(kind, 'annotate'))).toEqual({
        action: 'tool',
        mode: 'annotate',
        tool: 'paint',
      });
      expect(chromeCommandFor('x', ctx(kind, 'annotate'))).toEqual({
        action: 'tool',
        mode: 'annotate',
        tool: 'paint-erase',
      });
      // Et depuis n'importe quel mode : la lettre bascule vers celui qui porte l'outil.
      expect(chromeCommandFor('p', ctx(kind, 'explore'))).toEqual({
        action: 'tool',
        mode: 'annotate',
        tool: 'paint',
      });
    }
  });

  it('le mode « Annoter » d’un modèle ne se réduit plus à la navigation et l’épingle', () => {
    const ids = toolsFor('annotate', 'MODEL_3D').map((tool) => tool.id);
    expect(ids).toContain('paint');
    expect(ids).toContain('paint-erase');
    // Les outils de nuage, eux, restent propres au splat : ils masquent des splats.
    expect(toolsFor('clean', 'MODEL_3D').map((tool) => tool.id)).not.toContain('sel-rect');
  });

  it('aucun outil du rail n’est sans lettre, et aucune lettre ne sert deux outils d’un mode', () => {
    // Le défaut soldé au lot 4 : une lettre orpheline, ou deux outils d'un même mode sur la même
    // touche — la seconde n'aurait jamais répondu, `chromeCommandFor` rendant la première.
    for (const kind of KINDS)
      for (const mode of modesFor(kind)) {
        const tools = toolsFor(mode.value, kind);
        const keys = tools.map((tool) => tool.key);
        expect(new Set(keys).size).toBe(keys.length);
        for (const tool of tools) expect(tool.key).toMatch(/^[A-Z]$/);
      }
  });

  /**
   * Le déplacement de forme était sur `M`, la touche du transport vidéo : le transport la
   * gardait en coupant la remontée, et le bouton du rail annonçait un raccourci qui, sur une
   * vidéo, n'armait jamais rien. L'outil est passé sur `S`.
   */
  it('M appartient au transport : la lettre n’arme aucun outil, S déplace les formes', () => {
    for (const kind of ['VIDEO', 'IMAGE'] as const) {
      expect(chromeCommandFor('m', ctx(kind))).toBeNull();
      expect(chromeCommandFor('s', ctx(kind))).toEqual({
        action: 'tool',
        mode: 'annotate',
        tool: 'shape-move',
      });
    }
  });

  it('aucune touche d’outil plat ne redouble le transport vidéo', () => {
    // Espace, J/K/L, I/O (boucle), M (commentaire), [ ] et \ (décalage A/B) appartiennent au
    // lecteur ; `G` au leader de navigation globale.
    const taken = ['J', 'K', 'L', 'I', 'O', 'M', 'G', '[', ']', '\\'];
    for (const kind of ['VIDEO', 'IMAGE'] as const)
      for (const mode of modesFor(kind))
        for (const tool of toolsFor(mode.value, kind)) expect(taken).not.toContain(tool.key);
  });

  it('le rail du mode Compare n’a plus que l’état de repos', () => {
    // Le mode compare, et lui seul, perd son outil : « Annoter » garde tout son tracé.
    for (const kind of ['VIDEO', 'IMAGE'] as const) {
      expect(toolsFor('compare', kind).map((tool) => tool.id)).toEqual(['nav']);
      expect(toolsFor('annotate', kind).length).toBeGreaterThan(1);
    }
  });

  it('un rail restreint restreint le clavier — le montage n’a ni compare ni wipe', () => {
    const montage: ChromeKeyContext = {
      kind: 'VIDEO',
      mode: 'explore',
      tool: 'nav',
      modes: switcherModesFor('VIDEO').slice(0, 1),
      toolsOf: (m) => toolsFor(m, 'VIDEO').filter((t) => t.id === 'nav' || m === 'annotate'),
    };
    expect(chromeCommandFor('2', montage)).toBeNull();
    expect(chromeCommandFor('w', montage)).toBeNull();
    expect(chromeCommandFor('v', montage)).toEqual({ action: 'tool', mode: 'explore', tool: 'nav' });
  });
});

const groups = reviewShortcutGroups();
const allShortcuts = groups.flatMap((g) => g.shortcuts);
const charsOf = (keys: KeyToken[]) => keys.flatMap((k) => ('char' in k ? [k.char] : []));

describe('registre des raccourcis — l’aide ne peut plus diverger du code', () => {
  it('chaque entrée nomme le gestionnaire qui l’exécute', () => {
    expect(allShortcuts.length).toBeGreaterThan(20);
    for (const s of allShortcuts) expect(s.handler).toMatch(/^[A-Za-z][A-Za-z0-9]*$/);
  });

  it('toutes les touches d’outils du rail sont décrites, sans en inventer', () => {
    // Dérivées de `tools.ts` : toute lettre du rail figure au registre, et le registre n'a pas
    // d'outil que le rail ne propose pas. C'est là que l'aide et le code divergeaient.
    const described = new Set(allShortcuts.map((s) => s.labelKey));
    for (const kind of KINDS)
      for (const mode of modesFor(kind))
        for (const tool of toolsFor(mode.value, kind)) expect(described.has(tool.labelKey)).toBe(true);
    for (const kind of KINDS)
      for (const action of viewActionsFor(kind)) expect(described.has(action.labelKey)).toBe(true);
  });

  it('tous les libellés et noms de touches existent au catalogue anglais', () => {
    for (const g of groups) {
      expect(hasMessage(g.titleKey)).toBe(true);
      for (const s of g.shortcuts) {
        expect(hasMessage(s.labelKey)).toBe(true);
        for (const key of s.keys) if ('nameKey' in key) expect(hasMessage(key.nameKey)).toBe(true);
      }
    }
  });

  /**
   * Le garde-fou de la règle i18n : un nom de touche qui se traduit (« Espace », « Maj »,
   * « Suppr », « Clic droit », « ZQSD ») doit passer par `nameKey`. Un `char` ne peut donc être
   * qu'un caractère, ou l'un des trois modificateurs identiques dans toutes les langues.
   */
  it('aucun nom de touche traduisible n’est écrit en clair', () => {
    for (const char of allShortcuts.flatMap((s) => charsOf(s.keys)))
      expect(NEUTRAL_KEY_NAMES.includes(char) || /^[^\p{L}]*\p{L}?[^\p{L}]*$/u.test(char)).toBe(true);
  });

  it('un libellé par rangée dans un groupe — l’aide s’en sert comme identité de liste', () => {
    for (const g of groups) {
      const labels = g.shortcuts.map((s) => s.labelKey);
      expect(new Set(labels).size).toBe(labels.length);
    }
  });
});
