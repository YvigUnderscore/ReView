// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  ALL_WIDGET_IDS,
  HOME_WIDGETS,
  hiddenWidgets,
  reorderWidgets,
  resetWidgets,
  setWidgetSetting,
  setWidgetSize,
  spanClass,
  toggleWidget,
  visibleWidgets,
  widgetSettings,
  type HomeWidgetsPref,
} from './homeWidgets';
import { WIDGET_ROWS } from '../../components/widgets/widgetSizing';

describe('visibleWidgets', () => {
  it('renders the declaration layout with no preference', () => {
    expect(visibleWidgets(undefined)).toEqual(ALL_WIDGET_IDS);
  });

  it('respects the saved order', () => {
    const pref: HomeWidgetsPref = { order: ['activity', 'stats'] };
    expect(visibleWidgets(pref).slice(0, 2)).toEqual(['activity', 'stats']);
  });

  it('places blocks delivered after the save at their declaration rank', () => {
    const pref: HomeWidgetsPref = { order: ['activity'] };
    const list = visibleWidgets(pref);
    expect(list[0]).toBe('activity');
    // No known block disappears because it was missing from the saved order.
    expect(new Set(list)).toEqual(new Set(ALL_WIDGET_IDS));
  });

  it('drops the hidden ones', () => {
    expect(visibleWidgets({ hidden: ['stats'] })).not.toContain('stats');
  });

  it('ignores an unknown identifier left in the preference', () => {
    const pref: HomeWidgetsPref = { order: ['fantome', 'stats'], hidden: ['fantome'] };
    expect(visibleWidgets(pref)).toEqual(expect.arrayContaining(['stats']));
    expect(visibleWidgets(pref)).not.toContain('fantome' as never);
    expect(hiddenWidgets(pref)).toEqual([]);
  });
});

describe('widgetSettings', () => {
  it('applies the registry defaults', () => {
    const s = widgetSettings('projects', undefined);
    expect(s.span).toBe(HOME_WIDGETS.projects.span);
    expect(s.variant).toBe('grid');
    expect(s.bare).toBe(false);
    expect(s.density).toBe('comfortable');
  });

  it('applies the account settings', () => {
    const pref = setWidgetSetting('projects', { span: 12, bare: true }, undefined);
    const s = widgetSettings('projects', pref);
    expect(s.span).toBe(12);
    expect(s.bare).toBe(true);
  });

  it('refuses a width the block does not offer', () => {
    const pref: HomeWidgetsPref = { settings: { stats: { span: 3 } } };
    expect(widgetSettings('stats', pref).span).toBe(HOME_WIDGETS.stats.span);
  });

  it('refuses a variant the block cannot render', () => {
    const pref: HomeWidgetsPref = { settings: { myTasks: { variant: 'grid' } } };
    expect(widgetSettings('myTasks', pref).variant).toBe('list');
  });

  it('does not touch the settings of other blocks', () => {
    const pref = setWidgetSetting('projects', { span: 12 }, { settings: { myTasks: { bare: true } } });
    expect(widgetSettings('myTasks', pref).bare).toBe(true);
    expect(widgetSettings('projects', pref).span).toBe(12);
  });
});

describe('widgetSettings — height in rows (batch 13)', () => {
  it('applies the default height of the block', () => {
    for (const id of ALL_WIDGET_IDS) {
      expect(widgetSettings(id, undefined).rows).toBe(HOME_WIDGETS[id].rows);
      // A height outside the scale would produce no `row-span-*` class.
      expect(WIDGET_ROWS).toContain(HOME_WIDGETS[id].rows);
    }
  });

  it('applies the saved height', () => {
    const pref = setWidgetSize('activity', { span: 8, rows: 6 }, undefined);
    expect(widgetSettings('activity', pref).rows).toBe(6);
  });

  it('reads back a home page composed BEFORE the rows, without rewriting the preference', () => {
    // Layouts from before this batch carry only the `short`/`normal`/`tall` scale. It is
    // translated on read, so nobody loses the tall block they had set, and the saved preference
    // itself stays as it is.
    const before: HomeWidgetsPref = {
      settings: { activity: { height: 'tall' }, myTasks: { height: 'short' }, stats: { span: 8 } },
    };
    expect(widgetSettings('activity', before).rows).toBe(5);
    expect(widgetSettings('myTasks', before).rows).toBe(2);
    // No saved height: the block keeps its registry default.
    expect(widgetSettings('stats', before).rows).toBe(HOME_WIDGETS.stats.rows);
    expect(before.settings).toEqual({
      activity: { height: 'tall' },
      myTasks: { height: 'short' },
      stats: { span: 8 },
    });
  });

  it('refuses a height outside the scale rather than applying it wrongly', () => {
    const pref: HomeWidgetsPref = { settings: { stats: { rows: 9 } } };
    expect(widgetSettings('stats', pref).rows).toBe(HOME_WIDGETS.stats.rows);
  });
});

describe('setWidgetSize', () => {
  it('saves width and height in a single gesture', () => {
    // The handle sets both axes together; one save per axis would double the preference
    // writes.
    const pref = setWidgetSize('myTasks', { span: 12, rows: 5 }, undefined);
    expect(pref.settings?.myTasks).toEqual({ span: 12, rows: 5 });
    const settings = widgetSettings('myTasks', pref);
    expect([settings.span, settings.rows]).toEqual([12, 5]);
  });

  it('keeps the other settings of the block', () => {
    const base = setWidgetSetting('myTasks', { bare: true, density: 'compact' }, undefined);
    const pref = setWidgetSize('myTasks', { span: 8, rows: 2 }, base);
    const settings = widgetSettings('myTasks', pref);
    expect(settings.bare).toBe(true);
    expect(settings.density).toBe('compact');
    expect(settings.rows).toBe(2);
  });
});

describe('reorderWidgets', () => {
  it('moves a block to the place of another', () => {
    const pref = reorderWidgets('activity', 'stats', undefined);
    expect(visibleWidgets(pref)[0]).toBe('activity');
  });

  it('changes nothing when the target is the source', () => {
    expect(reorderWidgets('stats', 'stats', undefined)).toEqual({});
  });

  it('keeps hidden blocks in the saved order', () => {
    // Without this, unhiding a block would make it reappear at an arbitrary place.
    const pref: HomeWidgetsPref = { hidden: ['activity'] };
    const next = reorderWidgets('myTasks', 'stats', pref);
    expect(next.order).toContain('activity');
  });

  it('ignores a hidden block as a target', () => {
    const pref: HomeWidgetsPref = { hidden: ['activity'] };
    expect(reorderWidgets('stats', 'activity', pref)).toEqual(pref);
  });
});

describe('toggleWidget', () => {
  it('hides, then shows again', () => {
    const hiddenPref = toggleWidget('stats', false, undefined);
    expect(hiddenWidgets(hiddenPref)).toEqual(['stats']);
    expect(hiddenWidgets(toggleWidget('stats', true, hiddenPref))).toEqual([]);
  });

  it('preserves the order and the settings already saved', () => {
    // The preference is merged server-side key by key: overwriting `order` when hiding a block
    // would erase the whole layout.
    const base: HomeWidgetsPref = { order: ['activity'], settings: { stats: { span: 6 } } };
    const next = toggleWidget('stats', false, base);
    expect(next.order).toEqual(['activity']);
    expect(next.settings).toEqual({ stats: { span: 6 } });
  });
});

describe('resetWidgets', () => {
  it('renders the original layout', () => {
    const pref = resetWidgets();
    expect(pref.hidden).toEqual([]);
    expect(pref.order).toEqual(ALL_WIDGET_IDS);
    expect(visibleWidgets(pref)).toEqual(ALL_WIDGET_IDS);
  });
});

describe('spanClass', () => {
  it('renders classes written out in full, never interpolated', () => {
    // A class built by interpolation is purged at build time and produces nothing.
    for (const span of [3, 4, 6, 8, 12] as const) {
      expect(spanClass(span)).toMatch(/xl:col-span-\d+/);
      expect(spanClass(span)).not.toContain('${');
    }
  });
});
