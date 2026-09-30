// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  isRadioGroup,
  isSeparator,
  tidyMenu,
  toMenuEntries,
  type EntityItemAction,
  type MenuEntry,
} from '../../lib/menuSpec';
import { hasMessage, type MessageKey } from '../../i18n';
import {
  entityCardMenu,
  shotgridLabel,
  watchLabel,
  type EntityCardMenu,
  type EntityStateEntries,
} from './entityCardMenu';

const t = (key: MessageKey) => key;

/** Marque un trait de séparation dans la liste attendue — il n'a pas de libellé. */
const SEP = '--';

/** Épinglage aux favoris : `EntityCard` le pose lui-même, avant les actions du menu. */
const FAVORITE: EntityItemAction = { icon: null, label: 'favorites.pin' };

/** Une entrée de hook (statut, personnes…), réduite à son identifiant pour la lecture. */
const stateEntry = (id: string): MenuEntry => ({ id, label: id, onSelect: () => {} });

const ALL_STATE: EntityStateEntries = {
  status: stateEntry('status'),
  assign: stateEntry('assign'),
  people: stateEntry('people'),
  omit: stateEntry('omit'),
  hide: stateEntry('hide'),
};

function labelOf(entry: MenuEntry): string {
  if (isSeparator(entry)) return SEP;
  if (isRadioGroup(entry)) return entry.id;
  return entry.label;
}

/** Reproduit la composition d'`EntityCard` : entrées, puis épinglage, puis actions. */
function rendered(menu: EntityCardMenu): string[] {
  return tidyMenu([...menu.contextEntries, ...toMenuEntries([FAVORITE, ...menu.contextActions])]).map(
    labelOf,
  );
}

const shotMenu = (over: Partial<Parameters<typeof entityCardMenu>[0]> = {}) =>
  entityCardMenu({
    t,
    kind: 'shot',
    canManage: true,
    sgUrl: 'https://sg.example/Shot/1',
    watch: { watching: false, onToggle: () => {} },
    state: { status: ALL_STATE.status, people: ALL_STATE.people, omit: ALL_STATE.omit, hide: ALL_STATE.hide },
    onOpen: () => {},
    onSettings: () => {},
    onTrash: () => {},
    ...over,
  });

const assetMenu = () =>
  entityCardMenu({
    t,
    kind: 'asset',
    canManage: true,
    sgUrl: 'https://sg.example/Asset/1',
    watch: { watching: false, onToggle: () => {} },
    state: { assign: ALL_STATE.assign, people: ALL_STATE.people, hide: ALL_STATE.hide },
    onOpen: () => {},
    onSettings: () => {},
    onLink: () => {},
    onTrash: () => {},
  });

const sequenceMenu = () =>
  entityCardMenu({
    t,
    kind: 'sequence',
    canManage: true,
    sgUrl: 'https://sg.example/Sequence/1',
    state: { status: ALL_STATE.status, people: ALL_STATE.people, hide: ALL_STATE.hide },
    onOpen: () => {},
    onSettings: () => {},
    onTrash: () => {},
  });

describe('entityCardMenu — ordre du menu', () => {
  it('range le menu d’un plan en quatre blocs, l’épinglage avant la gestion', () => {
    expect(rendered(shotMenu())).toEqual([
      'common.open',
      SEP,
      'status',
      'people',
      'omit',
      'hide',
      SEP,
      'favorites.pin',
      'shots.watch',
      'shotgrid.openIn.shot',
      SEP,
      'entity.settings.open',
      'common.moveToTrash',
    ]);
  });

  it('range le menu d’un asset au même endroit, rattachement compris', () => {
    expect(rendered(assetMenu())).toEqual([
      'common.open',
      SEP,
      'assign',
      'people',
      'hide',
      SEP,
      'favorites.pin',
      'assets.watch',
      'shotgrid.openIn.asset',
      SEP,
      'entity.settings.open',
      'assets.assign',
      'common.moveToTrash',
    ]);
  });

  it('range le menu d’une séquence au même endroit, sans suivi ni omission', () => {
    expect(rendered(sequenceMenu())).toEqual([
      'common.open',
      SEP,
      'status',
      'people',
      'hide',
      SEP,
      'favorites.pin',
      'shotgrid.openIn.sequence',
      SEP,
      'entity.settings.open',
      'common.moveToTrash',
    ]);
  });

  it('présente les gestes communs dans le même ordre sur les trois types', () => {
    const shared = new Set([
      SEP,
      'common.open',
      'people',
      'hide',
      'favorites.pin',
      'entity.settings.open',
      'common.moveToTrash',
    ]);
    const skeleton = (menu: EntityCardMenu) => rendered(menu).filter((label) => shared.has(label));
    expect(skeleton(shotMenu())).toEqual(skeleton(assetMenu()));
    expect(skeleton(shotMenu())).toEqual(skeleton(sequenceMenu()));
  });
});

describe('entityCardMenu — vocabulaire', () => {
  it('n’invente aucun libellé : tous viennent du catalogue', () => {
    for (const menu of [shotMenu(), assetMenu(), sequenceMenu()]) {
      const own = [
        ...menu.hoverActions.map((a) => a.label),
        ...menu.contextActions.map((a) => a.label),
        ...menu.contextEntries.filter((e) => e.id === 'open').map(labelOf),
      ];
      expect(own.length).toBeGreaterThan(0);
      for (const label of own) expect(hasMessage(label)).toBe(true);
    }
  });

  it('annonce la corbeille, pas une suppression : le geste est réversible', () => {
    const menu = shotMenu();
    const labels = menu.contextActions.map((a) => a.label);
    expect(labels).toContain('common.moveToTrash');
    expect(labels).not.toContain('common.delete');
    expect(menu.hoverActions.map((a) => a.label)).not.toContain('common.delete');
  });

  it('annonce les réglages, pas une modification : le crayon ouvre le panneau', () => {
    const labels = shotMenu().hoverActions.map((a) => a.label);
    expect(labels).toContain('entity.settings.open');
    expect(labels).not.toContain('common.edit');
  });

  it('nomme le suivi selon le type suivi, et son état', () => {
    expect(watchLabel(t, 'shot', false)).toBe('shots.watch');
    expect(watchLabel(t, 'shot', true)).toBe('shots.unwatch');
    expect(watchLabel(t, 'asset', false)).toBe('assets.watch');
    expect(watchLabel(t, 'asset', true)).toBe('assets.unwatch');
  });

  it('nomme la fiche ShotGrid selon le type d’entité', () => {
    expect(shotgridLabel(t, 'shot')).toBe('shotgrid.openIn.shot');
    expect(shotgridLabel(t, 'asset')).toBe('shotgrid.openIn.asset');
    expect(shotgridLabel(t, 'sequence')).toBe('shotgrid.openIn.sequence');
  });
});

describe('entityCardMenu — ce que le menu offre', () => {
  it('reprend tout ce que l’ancien menu de plan offrait', () => {
    // Ancien inventaire : statut, personnes, omission, masquage, épinglage, fiche
    // ShotGrid, suivi, ouverture des réglages, mise à la corbeille.
    expect(rendered(shotMenu())).toEqual(
      expect.arrayContaining([
        'status',
        'people',
        'omit',
        'hide',
        'favorites.pin',
        'shotgrid.openIn.shot',
        'shots.watch',
        'entity.settings.open',
        'common.moveToTrash',
      ]),
    );
  });

  it('reprend tout ce que l’ancien menu d’asset offrait', () => {
    expect(rendered(assetMenu())).toEqual(
      expect.arrayContaining([
        'assign',
        'people',
        'hide',
        'favorites.pin',
        'shotgrid.openIn.asset',
        'common.open',
        'assets.watch',
        'entity.settings.open',
        'assets.assign',
        'common.moveToTrash',
      ]),
    );
  });

  it('reprend tout ce que l’ancien menu de séquence offrait', () => {
    expect(rendered(sequenceMenu())).toEqual(
      expect.arrayContaining([
        'common.open',
        'status',
        'people',
        'hide',
        'shotgrid.openIn.sequence',
        'entity.settings.open',
        'common.moveToTrash',
        'favorites.pin',
      ]),
    );
  });

  it('propose au survol exactement les gestes de gestion du menu, dans le même ordre', () => {
    for (const menu of [shotMenu(), assetMenu(), sequenceMenu()]) {
      const hover = menu.hoverActions.map((a) => a.label);
      const context = menu.contextActions.map((a) => a.label);
      expect(context.slice(context.length - hover.length)).toEqual(hover);
    }
  });

  it('ouvre un bloc de gestion séparé du suivi', () => {
    const menu = shotMenu();
    const settings = menu.contextActions.find((a) => a.label === 'entity.settings.open');
    expect(settings?.separatorBefore).toBe(true);
  });
});

describe('entityCardMenu — ce que le menu retire', () => {
  it('ne propose ni réglages, ni rattachement, ni corbeille à un spectateur', () => {
    const menu = shotMenu({ canManage: false });
    expect(menu.hoverActions).toEqual([]);
    expect(rendered(menu)).toEqual([
      'common.open',
      SEP,
      'status',
      'people',
      'omit',
      'hide',
      SEP,
      'favorites.pin',
      'shots.watch',
      'shotgrid.openIn.shot',
    ]);
  });

  it('ne laisse aucun trait dans le vide quand tout est retiré', () => {
    const menu = shotMenu({ canManage: false, sgUrl: null, watch: null, state: {} });
    expect(rendered(menu)).toEqual(['common.open', SEP, 'favorites.pin']);
  });

  it('n’offre pas le suivi sur une séquence, que l’API ne sait pas suivre', () => {
    const menu = entityCardMenu({
      t,
      kind: 'sequence',
      canManage: false,
      watch: { watching: true, onToggle: () => {} },
      onOpen: () => {},
      onSettings: () => {},
      onTrash: () => {},
    });
    expect(menu.contextActions).toEqual([]);
    expect(watchLabel(t, 'sequence', true)).toBeNull();
  });

  it('n’offre la fiche ShotGrid que si l’entité y est reliée', () => {
    expect(rendered(shotMenu({ sgUrl: null }))).not.toContain('shotgrid.openIn.shot');
  });

  it('n’offre le rattachement qu’aux entités qui en ont un', () => {
    expect(shotMenu().hoverActions.map((a) => a.label)).not.toContain('assets.assign');
    expect(assetMenu().hoverActions.map((a) => a.label)).toContain('assets.assign');
  });
});
