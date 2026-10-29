// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  hiddenWidgets as genericHidden,
  registryIds,
  reorderWidgets as genericReorder,
  resetWidgets as genericReset,
  setWidgetSetting as genericSetSetting,
  toggleWidget as genericToggle,
  visibleWidgets as genericVisible,
  widgetSettings as genericSettings,
  type ResolvedWidgetSettings,
  type WidgetDefinition,
  type WidgetSettings,
  type WidgetsPref,
} from '../../lib/widgetLayout';
import { resolveRows, type WidgetRows, type WidgetSize } from '../../components/widgets/widgetSizing';

/**
 * Registry of the home blocks (C2).
 *
 * The page was already composable, but only very loosely: three columns frozen in the code, one
 * widget assigned to one of them once and for all, one-notch moves through a context menu, and no
 * settings at all: neither size, density nor variant. An "activity" block could not move up to the
 * main column, and the page could be neither tightened nor simplified.
 *
 * From now on: a twelve-column grid, a single order, and each block carrying its size, its height,
 * its density, its variant and whether its frame is shown. Everything is persisted per account in
 * the `homeWidgets` preference.
 *
 * The composition rules are no longer written here: they are shared with the project overview
 * (`lib/widgetLayout`), which asks for the same gestures. This file keeps only what belongs to the
 * home page itself, its blocks, and binds the registry to the common functions so that callers do
 * not have to repeat it at every call.
 *
 * Since batch 13, each block also carries its **height in rows** (`components/widgets/widgetSizing`):
 * it is the size model of the overview, requested identically for the home page. The height is
 * read back in three steps (saved rows, old `short`/`normal`/`tall` scale translated, block
 * default), so that a home page composed before this batch opens without a gap and **without
 * rewriting** the preference.
 */

export type HomeWidgetId = 'stats' | 'projects' | 'myTasks' | 'latestReviews' | 'activity';

export type {
  ResolvedWidgetSettings,
  WidgetDensity,
  WidgetHeight,
  WidgetSpan,
  WidgetVariant,
} from '../../lib/widgetLayout';

/** Settings of a home block: the common shape, renamed for its callers. */
export type HomeWidgetSettings = WidgetSettings;

/** `homeWidgets` preference: absent means the default layout. */
export type HomeWidgetsPref = WidgetsPref;

/** A home block: the common definition, plus its default height in rows. */
export interface HomeWidgetDefinition extends WidgetDefinition {
  rows: WidgetRows;
}

/**
 * Declaration order = default layout of a new account.
 *
 * Each block now carries its height as well as its width: counters fit in two rows, lists and the
 * project grid in four. It is this height that stops the page from opening on three-line cards
 * followed by empty space.
 */
export const HOME_WIDGETS: Record<HomeWidgetId, HomeWidgetDefinition> = {
  stats: { labelKey: 'home.widget.stats', span: 12, spans: [6, 8, 12], rows: 2, variants: ['kpi'] },
  projects: {
    labelKey: 'home.recentProjects',
    span: 12,
    spans: [4, 6, 8, 12],
    rows: 4,
    variants: ['grid', 'list'],
  },
  myTasks: { labelKey: 'home.myTasks', span: 6, spans: [4, 6, 8, 12], rows: 4, variants: ['list'] },
  latestReviews: {
    labelKey: 'home.latestReviews',
    span: 6,
    spans: [4, 6, 8, 12],
    rows: 4,
    variants: ['list'],
  },
  activity: { labelKey: 'home.recentActivity', span: 6, spans: [3, 4, 6, 8], rows: 4, variants: ['list'] },
};

export const ALL_WIDGET_IDS = registryIds(HOME_WIDGETS);

export const isWidgetId = (v: string): v is HomeWidgetId => v in HOME_WIDGETS;

/** Hidden widgets (preference filtered on the identifiers still known). */
export const hiddenWidgets = (pref: HomeWidgetsPref | undefined): HomeWidgetId[] =>
  genericHidden(HOME_WIDGETS, pref);

/** Effective order of the page, minus the hidden blocks. */
export const visibleWidgets = (pref: HomeWidgetsPref | undefined): HomeWidgetId[] =>
  genericVisible(HOME_WIDGETS, pref);

/** Settings of a home block: those of any composable page, plus the height. */
export interface HomeResolvedSettings extends ResolvedWidgetSettings {
  rows: WidgetRows;
}

/** Effective settings of a block: the account's, completed by the registry defaults. */
export const widgetSettings = (
  id: HomeWidgetId,
  pref: HomeWidgetsPref | undefined,
): HomeResolvedSettings => ({
  ...genericSettings(HOME_WIDGETS, id, pref),
  rows: resolveRows(pref?.settings?.[id], HOME_WIDGETS[id].rows),
});

/** Applies a setting to a block; returns the preference patch. */
export const setWidgetSetting = (
  id: HomeWidgetId,
  patch: HomeWidgetSettings,
  pref: HomeWidgetsPref | undefined,
): HomeWidgetsPref => genericSetSetting(id, patch, pref);

/**
 * Saves a size in a single gesture: width and height go together, because the handle sets them
 * together, and one save per axis would double the preference writes.
 */
export const setWidgetSize = (
  id: HomeWidgetId,
  size: WidgetSize,
  pref: HomeWidgetsPref | undefined,
): HomeWidgetsPref => genericSetSetting(id, { span: size.span, rows: size.rows }, pref);

/** Reorders the page after a move; returns the preference patch. */
export const reorderWidgets = (
  activeId: HomeWidgetId,
  overId: HomeWidgetId,
  pref: HomeWidgetsPref | undefined,
): HomeWidgetsPref => genericReorder(HOME_WIDGETS, activeId, overId, pref);

/** Hides or shows a block; returns the preference patch. */
export const toggleWidget = (
  id: HomeWidgetId,
  visible: boolean,
  pref: HomeWidgetsPref | undefined,
): HomeWidgetsPref => genericToggle(HOME_WIDGETS, id, visible, pref);

/** Restores the page to its original layout. */
export const resetWidgets = (): HomeWidgetsPref => genericReset(HOME_WIDGETS);

export { spanClass } from '../../lib/widgetLayout';
