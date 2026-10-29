// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import type { WidgetsPref } from '@/v2/lib/widgetLayout';
import { OVERVIEW_ROWS } from './overviewSizing';
import {
  ALL_OVERVIEW_IDS,
  BUILTIN_ROLE_LAYOUTS,
  OVERVIEW_WIDGETS,
  OVERVIEW_WIDGET_DEFS,
  addableOverviewWidgets,
  hiddenOverviewWidgets,
  overviewWidgetSettings,
  reorderOverviewWidgets,
  resolveOverviewLayout,
  roleLayout,
  setOverviewWidgetSize,
  toggleOverviewWidget,
  visibleOverviewWidgets,
} from './overviewWidgets';

/**
 * The rules of the composable overview. What is verified here is not the common algebra
 * (`lib/widgetLayout`, covered by `homeWidgets.test`) but what this page adds: the fallback to the
 * role default, and the filtering of reserved blocks.
 */

describe('registry', () => {
  it('declares one definition per identifier, in the same order', () => {
    expect(ALL_OVERVIEW_IDS).toEqual([...OVERVIEW_WIDGETS]);
  });

  it('reserves for managers only the blocks whose read the server refuses', () => {
    const reserved = ALL_OVERVIEW_IDS.filter((id) => OVERVIEW_WIDGET_DEFS[id].manage);
    expect(reserved).toEqual(['attention', 'retakes']);
  });
});

describe('resolveOverviewLayout', () => {
  const role: WidgetsPref = {
    order: ['activity', 'counts'],
    hidden: ['tasks'],
    settings: { activity: { span: 6 }, counts: { span: 4 } },
  };

  it('serves the role default to someone who has customized nothing', () => {
    expect(resolveOverviewLayout(undefined, role)).toEqual(role);
    expect(resolveOverviewLayout(null, role)).toEqual(role);
  });

  it('keeps the role order when the person has only hidden something', () => {
    // The fallback is per FIELD: hiding a block says nothing about the order, and an "all or
    // nothing" fallback would lose the order decided by the administration at the first hiding.
    const resolved = resolveOverviewLayout({ hidden: ['activity'] }, role);
    expect(resolved.order).toEqual(['activity', 'counts']);
    expect(resolved.hidden).toEqual(['activity']);
  });

  it('overlays the settings: the role ones first, the person ones on top', () => {
    const resolved = resolveOverviewLayout({ settings: { activity: { span: 12 } } }, role);
    expect(resolved.settings).toEqual({ activity: { span: 12 }, counts: { span: 4 } });
  });

  it('without role or person, renders nothing to hide or to order', () => {
    expect(resolveOverviewLayout(undefined, undefined)).toEqual({});
  });
});

describe('roleLayout', () => {
  it('prefers the default set by the administration', () => {
    const studio = { ARTIST: { hidden: ['activity'] } };
    expect(roleLayout(studio, 'ARTIST')).toEqual(studio.ARTIST);
  });

  it('falls back to the layout shipped with the product', () => {
    expect(roleLayout({}, 'SUPERVISOR')).toEqual(BUILTIN_ROLE_LAYOUTS.SUPERVISOR);
    expect(roleLayout(undefined, 'CLIENT')).toEqual(BUILTIN_ROLE_LAYOUTS.CLIENT);
  });

  it('treats an unknown role as the most restricted of the internal roles', () => {
    expect(roleLayout(undefined, null)).toEqual(BUILTIN_ROLE_LAYOUTS.ARTIST);
  });

  it('gives each role a page that speaks to it', () => {
    // An artist comes in through their work, a supervisor through what is blocking, a client
    // through what there is to look at. This is the promise of the per-role default; without it,
    // the feature reduces to "everyone will redo their page".
    expect(visibleOverviewWidgets(BUILTIN_ROLE_LAYOUTS.ARTIST, false)[0]).toBe('myTasks');
    expect(visibleOverviewWidgets(BUILTIN_ROLE_LAYOUTS.SUPERVISOR, true)[0]).toBe('attention');
    expect(visibleOverviewWidgets(BUILTIN_ROLE_LAYOUTS.CLIENT, false)).toEqual(['latestMedia', 'activity']);
  });
});

describe('visibleOverviewWidgets', () => {
  it('renders the declaration order with no layout', () => {
    expect(visibleOverviewWidgets(undefined, true)).toEqual([...OVERVIEW_WIDGETS]);
  });

  it('drops the hidden blocks', () => {
    expect(visibleOverviewWidgets({ hidden: ['counts'] }, true)).not.toContain('counts');
  });

  it('drops the reserved blocks for whoever does not manage the project', () => {
    const visible = visibleOverviewWidgets(undefined, false);
    expect(visible).not.toContain('attention');
    expect(visible).not.toContain('retakes');
    expect(visible).toContain('activity');
  });

  it('ignores an unknown identifier left in the layout', () => {
    const pref: WidgetsPref = { order: ['fantome', 'counts'], hidden: ['fantome'] };
    expect(visibleOverviewWidgets(pref, true)).toEqual(expect.arrayContaining(['counts']));
    expect(hiddenOverviewWidgets(pref)).toEqual([]);
  });
});

describe('addableOverviewWidgets', () => {
  it('never offers to add a block whose content the server would refuse', () => {
    const hiddenAll: WidgetsPref = { hidden: ['attention', 'retakes', 'counts'] };
    expect(addableOverviewWidgets(hiddenAll, false)).toEqual(['counts']);
    // The catalogue follows the order in which blocks were removed, not that of the registry.
    expect(addableOverviewWidgets(hiddenAll, true)).toEqual(['attention', 'retakes', 'counts']);
  });
});

describe('gestes de composition', () => {
  it('hides then shows again without losing the role order', () => {
    const base = resolveOverviewLayout(undefined, BUILTIN_ROLE_LAYOUTS.ARTIST);
    const hidden = toggleOverviewWidget('activity', false, base);
    expect(visibleOverviewWidgets(hidden, false)).not.toContain('activity');
    expect(hidden.order).toEqual(base.order);
    expect(visibleOverviewWidgets(toggleOverviewWidget('activity', true, hidden), false)).toContain(
      'activity',
    );
  });

  it('reorders while keeping the hidden blocks in their saved order', () => {
    const next = reorderOverviewWidgets('activity', 'counts', { hidden: ['tasks'] });
    expect(next.order?.[0]).toBe('activity');
    expect(next.order).toContain('tasks');
  });

  it('applies the layout settings, otherwise the registry ones', () => {
    expect(overviewWidgetSettings('activity', { settings: { activity: { span: 12 } } }).span).toBe(12);
    expect(overviewWidgetSettings('activity', undefined).span).toBe(OVERVIEW_WIDGET_DEFS.activity.span);
    // A width the block does not offer is refused, not applied wrongly.
    expect(overviewWidgetSettings('counts', { settings: { counts: { span: 3 } } }).span).toBe(
      OVERVIEW_WIDGET_DEFS.counts.span,
    );
  });

  it('saves width and height in a single gesture', () => {
    const next = setOverviewWidgetSize(
      'activity',
      { span: 12, rows: 6 },
      { settings: { activity: { span: 4 } } },
    );
    expect(next.settings?.activity).toEqual({ span: 12, rows: 6 });
  });
});

describe('heights', () => {
  it('gives each block a default height', () => {
    for (const id of ALL_OVERVIEW_IDS)
      expect(OVERVIEW_ROWS).toContain(overviewWidgetSettings(id, undefined).rows);
  });

  it('applies the saved height', () => {
    expect(overviewWidgetSettings('activity', { settings: { activity: { rows: 6 } } }).rows).toBe(6);
  });

  it('reads back without breaking a layout saved before the heights', () => {
    // Neither height nor rows: the block takes its default, and nothing is rewritten.
    expect(overviewWidgetSettings('counts', { settings: { counts: { span: 6 } } }).rows).toBe(
      OVERVIEW_WIDGET_DEFS.counts.rows,
    );
    // The old scale, on the other hand, is translated: the tall block one had set is not lost.
    expect(overviewWidgetSettings('activity', { settings: { activity: { height: 'tall' } } }).rows).toBe(5);
  });

  it('carries the heights into the layouts shipped per role', () => {
    // The per-role default of batch 10 must keep working AND carry a height: otherwise an artist's
    // page would reopen on the short cards that have just been corrected.
    const artist = resolveOverviewLayout(undefined, BUILTIN_ROLE_LAYOUTS.ARTIST);
    expect(overviewWidgetSettings('myTasks', artist).rows).toBe(5);
    expect(overviewWidgetSettings('activity', artist).rows).toBe(5);
    const client = resolveOverviewLayout(undefined, BUILTIN_ROLE_LAYOUTS.CLIENT);
    expect(overviewWidgetSettings('latestMedia', client).rows).toBe(4);
  });
});
