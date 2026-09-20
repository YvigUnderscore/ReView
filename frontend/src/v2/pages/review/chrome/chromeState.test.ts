// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  chromePrefsKey,
  defaultChromeState,
  drawerForKind,
  readChromePrefs,
  reconcileChrome,
  type ChromeState,
} from './chromeState';
import { allowedModesFor, modesFor, switcherModesFor } from './modes';
import { panelsFor } from './panels';
import { toolSearchOrder, toolsFor, viewActionsFor } from './tools';

describe('modes', () => {
  it('ouvre chaque type de média sur l’exploration', () => {
    for (const kind of ['VIDEO', 'IMAGE', 'MODEL_3D', 'SPLAT'] as const) {
      expect(modesFor(kind)[0].value).toBe('explore');
    }
  });

  it('donne un quatrième mode aux seuls médias spatiaux', () => {
    // Les deux médias plats en sont à trois : l'image a perdu « Ajuster » (D1, une pipette
    // et un zoom pour une aide qui promettait exposition, gamma et canaux), la vidéo a perdu
    // « Découpe » (Phase 50). Ce test affirmait « quatre modes pour la vidéo » : il est
    // réécrit sur le nouvel état, qui est le choix qu'on veut tenir.
    expect(modesFor('MODEL_3D')).toHaveLength(4);
    expect(modesFor('SPLAT')).toHaveLength(4);
    expect(modesFor('VIDEO')).toHaveLength(3);
    expect(modesFor('IMAGE')).toHaveLength(3);
    expect(modesFor('VIDEO').map((m) => m.value)).toEqual(modesFor('IMAGE').map((m) => m.value));
  });

  it('donne les mêmes modes au modèle 3D et au splat', () => {
    expect(modesFor('MODEL_3D').map((m) => m.value)).toEqual(modesFor('SPLAT').map((m) => m.value));
  });

  it('la bascule ne liste pas Annoter, qui reste un mode valide', () => {
    for (const kind of ['VIDEO', 'IMAGE', 'MODEL_3D', 'SPLAT'] as const) {
      expect(switcherModesFor(kind).map((m) => m.value)).not.toContain('annotate');
      expect(switcherModesFor(kind)).toHaveLength(kind === 'IMAGE' || kind === 'VIDEO' ? 2 : 3);
      // `reconcileChrome` valide contre la liste complète : l'annotation s'arme ailleurs.
      expect(modesFor(kind).map((m) => m.value)).toContain('annotate');
    }
  });

  it('retire Compare quand aucune version voisine n’existe — le mode s’armait sur rien', () => {
    // Le sélecteur de comparaison disparaissait au même moment : on entrait dans un mode qui
    // ne montrait aucune comparaison, sans autre issue que d'en sortir.
    for (const kind of ['VIDEO', 'IMAGE'] as const) {
      expect(switcherModesFor(kind, true).map((m) => m.value)).toContain('compare');
      expect(switcherModesFor(kind, false).map((m) => m.value)).not.toContain('compare');
      expect(allowedModesFor(kind, false).map((m) => m.value)).not.toContain('compare');
      // Le reste du chrome ne bouge pas : seul « Compare » dépend des voisins.
      expect(allowedModesFor(kind, false).map((m) => m.value)).toContain('annotate');
    }
  });
});

describe('toolSearchOrder — un raccourci d’outil bascule vers le mode qui le porte', () => {
  it('commence par le mode courant, sans doublon, et couvre tous les modes', () => {
    const order = toolSearchOrder('VIDEO', 'compare');
    expect(order[0]).toBe('compare');
    expect(new Set(order).size).toBe(order.length);
    expect([...order].sort()).toEqual(
      modesFor('VIDEO')
        .map((m) => m.value)
        .sort(),
    );
  });

  it('en spatial, Nettoyer répond avant Mise en scène : T/R/S arment les gizmos', () => {
    const order = toolSearchOrder('MODEL_3D', 'explore');
    expect(order[0]).toBe('explore');
    expect(order.indexOf('clean')).toBeLessThan(order.indexOf('stage'));
    const t = toolsFor(
      order.find((m) => toolsFor(m, 'MODEL_3D').some((x) => x.key === 'T'))!,
      'MODEL_3D',
    );
    expect(t.find((x) => x.key === 'T')!.id).toBe('translate');
  });

  it('le mode courant garde la main sur ses propres touches (caméra de Mise en scène)', () => {
    const order = toolSearchOrder('MODEL_3D', 'stage');
    const first = order.find((m) => toolsFor(m, 'MODEL_3D').some((x) => x.key === 'T'))!;
    expect(toolsFor(first, 'MODEL_3D').find((x) => x.key === 'T')!.id).toBe('cam-move');
  });

  it('un outil de tracé reste joignable au clavier : D bascule en Annoter (vidéo)', () => {
    const order = toolSearchOrder('VIDEO', 'explore');
    const mode = order.find((m) => toolsFor(m, 'VIDEO').some((x) => x.key === 'D'))!;
    expect(mode).toBe('annotate');
  });
});

describe('tools', () => {
  it('commence toujours par nav', () => {
    for (const kind of ['VIDEO', 'IMAGE', 'MODEL_3D', 'SPLAT'] as const)
      for (const mode of modesFor(kind)) expect(toolsFor(mode.value, kind)[0].id).toBe('nav');
  });

  it('réserve les outils de sélection et le volume au splat', () => {
    expect(toolsFor('clean', 'SPLAT').map((t) => t.id)).toContain('sel-lasso');
    expect(toolsFor('clean', 'MODEL_3D').map((t) => t.id)).not.toContain('sel-lasso');
    // Les gizmos, eux, servent aux deux.
    expect(toolsFor('clean', 'MODEL_3D').map((t) => t.id)).toEqual(['nav', 'translate', 'rotate', 'scale']);
  });

  it('n’attribue jamais deux fois le même raccourci dans un mode', () => {
    for (const kind of ['VIDEO', 'IMAGE', 'MODEL_3D', 'SPLAT'] as const)
      for (const mode of modesFor(kind)) {
        const keys = toolsFor(mode.value, kind).map((t) => t.key);
        expect(new Set(keys).size).toBe(keys.length);
      }
  });

  it('propose Cadrer et Vue d’origine en 3D, Ajuster et 1:1 à plat', () => {
    expect(viewActionsFor('SPLAT').map((a) => a.key)).toEqual(['F', 'H']);
    expect(viewActionsFor('VIDEO').map((a) => a.labelKey)).toEqual(['action.fitMedia', 'action.resetMedia']);
  });
});

describe('panels', () => {
  it('n’expose l’éclairage que sur le modèle 3D', () => {
    expect(panelsFor('MODEL_3D').map((p) => p.id)).toContain('light');
    expect(panelsFor('SPLAT').map((p) => p.id)).not.toContain('light');
  });

  it('le dock plat n’a plus que Infos et Export, vidéo comme image', () => {
    // Ce test affirmait cinq onglets côté vidéo et trois côté image ; il est réécrit sur la
    // décision de Phase 50, prise par l'utilisateur en connaissance de la conséquence. Chacun
    // des cinq partis redisait le lecteur ou réglait au dock ce qu'on règle sur l'image :
    // « Comparaison » (le B vit dans la barre d'options), « Affichage » (une cadence sur une
    // image fixe), « Lecture » (la cadence, déjà dans la fiche technique), « Repères » (les
    // quatre interrupteurs sont au clic droit du viewer) et « Image » — le panneau Color, dont
    // le display/view reste celui du projet et continue de s'appliquer au viewer.
    for (const kind of ['VIDEO', 'IMAGE'] as const)
      expect(panelsFor(kind).map((p) => p.id)).toEqual(['info', 'export']);
  });

  it('n’offre plus au dock plat aucun des onglets retirés', () => {
    for (const kind of ['VIDEO', 'IMAGE'] as const) {
      const ids = panelsFor(kind).map((p) => String(p.id));
      for (const gone of ['compare', 'view', 'playback', 'image', 'guides']) expect(ids).not.toContain(gone);
    }
  });

  it('ne touche pas au dock spatial, qui garde ses six onglets', () => {
    expect(panelsFor('MODEL_3D').map((p) => p.id)).toEqual([
      'camera',
      'light',
      'display',
      'scene',
      'info',
      'export',
    ]);
  });
});

describe('reconcileChrome', () => {
  const state = (patch: Partial<ChromeState>): ChromeState => ({
    ...defaultChromeState(),
    panel: 'camera',
    ...patch,
  });

  it('laisse un état cohérent intact (même référence)', () => {
    const s = state({});
    expect(reconcileChrome(s, 'SPLAT')).toBe(s);
  });

  it('replie l’outil sur nav quand il n’existe pas dans le mode', () => {
    const s = state({ mode: 'explore', tool: 'sel-lasso' });
    expect(reconcileChrome(s, 'SPLAT').tool).toBe('nav');
  });

  it('garde l’outil quand le mode le contient', () => {
    const s = state({ mode: 'clean', tool: 'sel-lasso' });
    expect(reconcileChrome(s, 'SPLAT').tool).toBe('sel-lasso');
  });

  it('rabat un mode spatial sur explore quand on passe à un média plat', () => {
    const s = state({ mode: 'clean', tool: 'sel-rect' });
    const next = reconcileChrome(s, 'VIDEO');
    expect(next.mode).toBe('explore');
    expect(next.tool).toBe('nav');
  });

  it('rabat Compare sur l’exploration quand aucune version voisine n’existe', () => {
    const s = state({ mode: 'compare', panel: null });
    expect(reconcileChrome(s, 'IMAGE', true).mode).toBe('compare');
    expect(reconcileChrome(s, 'IMAGE', false).mode).toBe('explore');
    // Et l'outil suit : le wipe n'existe que dans le mode de comparaison.
    expect(reconcileChrome(state({ mode: 'compare', tool: 'wipe', panel: null }), 'IMAGE', false).tool).toBe(
      'nav',
    );
  });

  it('remplace un panneau absent du dock par le premier, mais respecte le dock replié', () => {
    expect(reconcileChrome(state({ panel: 'light' }), 'SPLAT').panel).toBe('camera');
    expect(reconcileChrome(state({ panel: null }), 'SPLAT').panel).toBeNull();
  });

  it('rabat sur Infos un panneau retiré du dock plat (Phase 50)', () => {
    // Un état porté d'un média spatial ou d'un onglet supprimé ne doit pas laisser le dock
    // ouvert sur du vide : le premier panneau du média prend la place.
    for (const kind of ['VIDEO', 'IMAGE'] as const) {
      expect(reconcileChrome(state({ panel: 'camera' }), kind).panel).toBe('info');
      expect(reconcileChrome(state({ panel: 'export' }), kind).panel).toBe('export');
    }
  });

  it('ferme le tiroir qui n’appartient pas à la famille de média', () => {
    expect(reconcileChrome(state({ drawer: 'curves' }), 'SPLAT').drawer).toBe('curves');
    expect(reconcileChrome(state({ drawer: 'curves' }), 'VIDEO').drawer).toBeNull();
    expect(reconcileChrome(state({ drawer: 'strip' }), 'VIDEO').drawer).toBe('strip');
  });
});

describe('préférences', () => {
  it('nomme la clé par type de média', () => {
    expect(chromePrefsKey('SPLAT')).toBe('review.chrome.SPLAT');
    expect(chromePrefsKey('VIDEO')).not.toBe(chromePrefsKey('IMAGE'));
  });

  it('choisit le tiroir de la famille', () => {
    expect(drawerForKind('MODEL_3D')).toBe('curves');
    expect(drawerForKind('IMAGE')).toBe('strip');
  });

  it('relit des préférences valides', () => {
    const raw = JSON.stringify({
      panel: 'scene',
      labels: true,
      comments: false,
      drawerOpen: true,
      drawerH: 240,
    });
    expect(readChromePrefs('SPLAT', raw)).toEqual({
      panel: 'scene',
      labels: true,
      comments: false,
      drawerOpen: true,
      drawerH: 240,
    });
  });

  it('retombe sur les défauts si la valeur est absente, corrompue ou étrangère au média', () => {
    // Défaut : dock replié — le média passe avant les réglages tant qu'on n'a rien choisi.
    const fallback = { panel: null, labels: false, comments: true, drawerOpen: false, drawerH: 168 };
    expect(readChromePrefs('SPLAT', null)).toEqual(fallback);
    expect(readChromePrefs('SPLAT', '{oops')).toEqual(fallback);
    // `light` n'existe pas dans le dock d'un splat.
    expect(readChromePrefs('SPLAT', JSON.stringify({ panel: 'light' })).panel).toBeNull();
    // Préférence héritée d'un panneau supprimé (`view`, `compare`, `guides`, et depuis la
    // Phase 50 `playback` et `image`) : le dock se replie au lieu d'ouvrir un onglet qui
    // n'existe plus. C'est le défaut du dock, et c'est plus juste que d'imposer Infos à qui
    // n'a jamais demandé Infos — `reconcileChrome`, lui, garde un dock déjà ouvert et prend
    // le premier panneau.
    for (const panel of ['view', 'compare', 'guides', 'playback', 'image'])
      for (const kind of ['VIDEO', 'IMAGE'] as const)
        expect(readChromePrefs(kind, JSON.stringify({ panel })).panel).toBeNull();
    // Les deux onglets qui restent, eux, sont relus tels quels.
    for (const panel of ['info', 'export'])
      expect(readChromePrefs('VIDEO', JSON.stringify({ panel })).panel).toBe(panel);
  });

  it('borne la hauteur du tiroir et ignore une valeur invalide', () => {
    expect(readChromePrefs('SPLAT', JSON.stringify({ drawerH: 9999 })).drawerH).toBe(480);
    expect(readChromePrefs('SPLAT', JSON.stringify({ drawerH: 10 })).drawerH).toBe(120);
    expect(readChromePrefs('SPLAT', JSON.stringify({ drawerH: 'big' })).drawerH).toBe(168);
  });

  it('conserve un dock explicitement replié', () => {
    expect(readChromePrefs('VIDEO', JSON.stringify({ panel: null })).panel).toBeNull();
  });
});

/**
 * Le verrou de publication ne touche plus AUCUN mode : `edit` — la découpe vidéo — était le
 * dernier, et il a disparu avec la fonctionnalité (Phase 50, lot 4). `isLockedByPublication`
 * et la table qu'il lisait ont donc été retirés plutôt que laissés à répondre « non » à
 * toutes les questions. Ce qui reste verrouillé côté serveur (transform de version,
 * re-finalisation) n'est pas un mode du chrome : son test vit dans `lib/publishLock.test.ts`.
 */
describe('modes et publication', () => {
  it('n’offre plus aucun mode que la publication fermerait', () => {
    for (const kind of ['VIDEO', 'IMAGE', 'MODEL_3D', 'SPLAT'] as const) {
      expect(modesFor(kind).map((m) => String(m.value))).not.toContain('edit');
    }
  });
});
