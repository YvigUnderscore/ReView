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

/** Marks a separator in the expected list: it has no label. */
const SEP = '--';

/** Pinning to favourites: `EntityCard` sets it itself, before the menu actions. */
const FAVORITE: EntityItemAction = { icon: null, label: 'favorites.pin' };

/** A hook entry (status, people…), reduced to its identifier for readability. */
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

/** Reproduces the composition of `EntityCard`: entries, then pinning, then actions. */
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

describe('entityCardMenu — menu order', () => {
  it('lays out the menu of a shot in four blocks, pinning before management', () => {
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

  it('lays out the menu of an asset in the same place, linking included', () => {
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

  it('lays out the menu of a sequence in the same place, without watching or omission', () => {
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

  it('presents the common gestures in the same order across the three types', () => {
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

describe('entityCardMenu — vocabulary', () => {
  it('invents no label: all of them come from the catalogue', () => {
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

  it('announces the trash, not a deletion: the gesture is reversible', () => {
    const menu = shotMenu();
    const labels = menu.contextActions.map((a) => a.label);
    expect(labels).toContain('common.moveToTrash');
    expect(labels).not.toContain('common.delete');
    expect(menu.hoverActions.map((a) => a.label)).not.toContain('common.delete');
  });

  it('announces settings, not a modification: the pencil opens the panel', () => {
    const labels = shotMenu().hoverActions.map((a) => a.label);
    expect(labels).toContain('entity.settings.open');
    expect(labels).not.toContain('common.edit');
  });

  it('names the watch according to the type watched, and its state', () => {
    expect(watchLabel(t, 'shot', false)).toBe('shots.watch');
    expect(watchLabel(t, 'shot', true)).toBe('shots.unwatch');
    expect(watchLabel(t, 'asset', false)).toBe('assets.watch');
    expect(watchLabel(t, 'asset', true)).toBe('assets.unwatch');
  });

  it('names the ShotGrid sheet according to the entity type', () => {
    expect(shotgridLabel(t, 'shot')).toBe('shotgrid.openIn.shot');
    expect(shotgridLabel(t, 'asset')).toBe('shotgrid.openIn.asset');
    expect(shotgridLabel(t, 'sequence')).toBe('shotgrid.openIn.sequence');
  });
});

describe('entityCardMenu — what the menu offers', () => {
  it('keeps everything the former shot menu offered', () => {
    // Former inventory: status, people, omission, hiding, pinning, ShotGrid sheet, watch, opening
    // settings, moving to the trash.
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

  it('keeps everything the former asset menu offered', () => {
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

  it('keeps everything the former sequence menu offered', () => {
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

  it('offers on hover exactly the management gestures of the menu, in the same order', () => {
    for (const menu of [shotMenu(), assetMenu(), sequenceMenu()]) {
      const hover = menu.hoverActions.map((a) => a.label);
      const context = menu.contextActions.map((a) => a.label);
      expect(context.slice(context.length - hover.length)).toEqual(hover);
    }
  });

  it('opens a management block separate from the watch', () => {
    const menu = shotMenu();
    const settings = menu.contextActions.find((a) => a.label === 'entity.settings.open');
    expect(settings?.separatorBefore).toBe(true);
  });
});

describe('entityCardMenu — what the menu removes', () => {
  it('offers neither settings, nor linking, nor trash to a viewer', () => {
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

  it('leaves no stray line in the void when everything is removed', () => {
    const menu = shotMenu({ canManage: false, sgUrl: null, watch: null, state: {} });
    expect(rendered(menu)).toEqual(['common.open', SEP, 'favorites.pin']);
  });

  it('offers no watch on a sequence, which the API cannot watch', () => {
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

  it('offers the ShotGrid sheet only if the entity is linked to it', () => {
    expect(rendered(shotMenu({ sgUrl: null }))).not.toContain('shotgrid.openIn.shot');
  });

  it('offers linking only to entities that have one', () => {
    expect(shotMenu().hoverActions.map((a) => a.label)).not.toContain('assets.assign');
    expect(assetMenu().hoverActions.map((a) => a.label)).toContain('assets.assign');
  });
});
