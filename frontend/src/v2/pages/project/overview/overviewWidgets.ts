// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  hiddenWidgets as genericHidden,
  registryIds,
  reorderWidgets as genericReorder,
  setWidgetSetting as genericSetSetting,
  toggleWidget as genericToggle,
  visibleWidgets as genericVisible,
  widgetSettings as genericSettings,
  type ResolvedWidgetSettings,
  type WidgetDefinition,
  type WidgetSettings,
  type WidgetsPref,
} from '../../../lib/widgetLayout';
import { resolveRows, type OverviewRows, type WidgetSize } from './overviewSizing';
import type { Role } from '../../../types/api';

/**
 * Registry of the project overview blocks (batch 10).
 *
 * The page was frozen: three counters, eight thumbnails, a gauge and two columns, in that order,
 * for everyone. Yet an artist, a supervisor and a producer do not open the same page: the first
 * comes to see what is asked of them, the second what is blocking, the third where the project
 * stands. The page is therefore composed **per person**, on a **per-role** default decided by the
 * administration.
 *
 * The list of identifiers is **copied verbatim on the server side** (`backend/src/lib/overviewWidgets.ts`),
 * which refuses to save a layout citing an unknown block; `overviewWidgets.test.ts` (backend)
 * refuses to let the two copies diverge. The composition rules, for their part, are those of any
 * composable page (`lib/widgetLayout`), shared with the home page.
 */
export const OVERVIEW_WIDGETS = [
  'counts',
  'myTasks',
  'latestMedia',
  'progress',
  'activity',
  'tasks',
  'attention',
  'retakes',
] as const;

export type OverviewWidgetId = (typeof OVERVIEW_WIDGETS)[number];

/** Top-level key of the preferences bag where a person's layout lives. */
export const OVERVIEW_PREFERENCE_KEY = 'projectOverview';

/**
 * A block of the overview. `manage` marks those whose content is **reserved for whoever manages
 * the project**: the server already refuses these reads to others (`requireProjectManage`), and a
 * block that would only display an error must not exist for them, neither on the page nor in the
 * catalogue of blocks to add.
 */
export interface OverviewWidgetDefinition extends WidgetDefinition {
  manage?: boolean;
  /** Default height, in grid rows (cf. `overviewSizing`). */
  rows: OverviewRows;
}

/**
 * Declaration order = layout shipped with the product, before any role default.
 *
 * Each block now carries its height as well as its width: the counters and the gauge fit in two
 * rows, the lists in four. It is this height that stops the page from opening on three-line cards
 * followed by empty space.
 */
export const OVERVIEW_WIDGET_DEFS: Record<OverviewWidgetId, OverviewWidgetDefinition> = {
  counts: { labelKey: 'overview.widget.counts', span: 12, spans: [4, 6, 8, 12], rows: 2, variants: ['kpi'] },
  myTasks: { labelKey: 'home.myTasks', span: 6, spans: [4, 6, 8, 12], rows: 4, variants: ['list'] },
  latestMedia: {
    labelKey: 'playlist.latestPublished',
    span: 12,
    spans: [6, 8, 12],
    rows: 3,
    variants: ['grid'],
  },
  progress: { labelKey: 'activity.title', span: 12, spans: [6, 8, 12], rows: 2, variants: ['kpi'] },
  activity: { labelKey: 'home.recentActivity', span: 6, spans: [4, 6, 8, 12], rows: 4, variants: ['list'] },
  tasks: { labelKey: 'overview.widget.tasks', span: 6, spans: [4, 6, 8, 12], rows: 4, variants: ['list'] },
  attention: {
    labelKey: 'production.section.attention',
    span: 12,
    spans: [6, 8, 12],
    rows: 4,
    variants: ['list'],
    manage: true,
  },
  retakes: {
    labelKey: 'production.retakes.title',
    span: 12,
    spans: [6, 8, 12],
    rows: 4,
    variants: ['list'],
    manage: true,
  },
};

export const ALL_OVERVIEW_IDS = registryIds(OVERVIEW_WIDGET_DEFS);

export const isOverviewWidget = (v: string): v is OverviewWidgetId => v in OVERVIEW_WIDGET_DEFS;

/**
 * Layouts shipped with the product, one per role.
 *
 * They are only a starting point (the administration replaces them, and everyone modifies them),
 * but they must already be right: a studio that sets nothing must open a page that speaks to each
 * person. The artist comes in through their work, the supervisor through what is blocking, and
 * the client through what there is to look at.
 */
export const BUILTIN_ROLE_LAYOUTS: Record<Role, WidgetsPref> = {
  ADMIN: {
    order: ['attention', 'progress', 'tasks', 'retakes', 'latestMedia', 'activity', 'counts', 'myTasks'],
    hidden: ['myTasks'],
    settings: {
      attention: { rows: 5 },
      progress: { rows: 2 },
      activity: { span: 6, rows: 5 },
      tasks: { span: 6, rows: 5 },
    },
  },
  SUPERVISOR: {
    order: ['attention', 'progress', 'tasks', 'retakes', 'latestMedia', 'activity', 'counts', 'myTasks'],
    hidden: ['myTasks'],
    settings: {
      attention: { rows: 5 },
      progress: { rows: 2 },
      activity: { span: 6, rows: 5 },
      tasks: { span: 6, rows: 5 },
    },
  },
  ARTIST: {
    order: ['myTasks', 'latestMedia', 'activity', 'progress', 'counts', 'tasks'],
    hidden: ['tasks', 'counts'],
    settings: {
      myTasks: { span: 6, rows: 5 },
      activity: { span: 6, rows: 5 },
      latestMedia: { rows: 3 },
    },
  },
  // A client comes to see what there is to look at, not the studio's internal organization.
  CLIENT: {
    order: ['latestMedia', 'activity', 'counts', 'progress', 'myTasks', 'tasks'],
    hidden: ['counts', 'progress', 'myTasks', 'tasks'],
    settings: { latestMedia: { rows: 4 }, activity: { span: 12, rows: 4 } },
  },
};

/**
 * Effective layout: the person's, **field by field**, completed by their role's default.
 *
 * The fallback is per field and not per block, which is the whole point: someone who hides a block
 * has said nothing about the order. An "all or nothing" fallback would lose the order decided by
 * the administration at the first hidden block, and the page would rearrange itself before their
 * eyes for a gesture that did not ask for so much. The settings, for their part, overlay: the role
 * ones first, the person's on top.
 */
export function resolveOverviewLayout(
  personal: WidgetsPref | undefined | null,
  roleLayout: WidgetsPref | undefined,
): WidgetsPref {
  const base = roleLayout ?? {};
  if (!personal) return base;
  return {
    hidden: personal.hidden ?? base.hidden,
    order: personal.order ?? base.order,
    settings: personal.settings || base.settings ? { ...base.settings, ...personal.settings } : undefined,
  };
}

/**
 * Default layout of a role: the studio's if the administration has set one, otherwise the one
 * shipped with the product. An unknown role (an account with no readable role) falls back to the
 * artist, the most restricted of the internal roles.
 */
export function roleLayout(
  defaults: Partial<Record<Role, WidgetsPref>> | undefined,
  role: Role | null,
): WidgetsPref {
  const effective: Role = role ?? 'ARTIST';
  return defaults?.[effective] ?? BUILTIN_ROLE_LAYOUTS[effective];
}

/** Hidden blocks, filtered on those the registry still knows. */
export const hiddenOverviewWidgets = (pref: WidgetsPref | undefined): OverviewWidgetId[] =>
  genericHidden(OVERVIEW_WIDGET_DEFS, pref);

/**
 * Effective order of the page. `canManage` drops the blocks whose content the server refuses: the
 * filter is here, at the source, so that the catalogue of blocks to add never offers what would
 * only display a 403.
 */
export function visibleOverviewWidgets(
  pref: WidgetsPref | undefined,
  canManage: boolean,
): OverviewWidgetId[] {
  return genericVisible(OVERVIEW_WIDGET_DEFS, pref).filter(
    (id) => canManage || !OVERVIEW_WIDGET_DEFS[id].manage,
  );
}

/** Hidden blocks that can be offered for adding, rights included. */
export function addableOverviewWidgets(
  pref: WidgetsPref | undefined,
  canManage: boolean,
): OverviewWidgetId[] {
  return hiddenOverviewWidgets(pref).filter((id) => canManage || !OVERVIEW_WIDGET_DEFS[id].manage);
}

/** Settings of a block on this page: those of any composable page, plus the height. */
export interface OverviewResolvedSettings extends ResolvedWidgetSettings {
  rows: OverviewRows;
}

/**
 * Effective settings of a block: those of the layout, completed by the registry.
 *
 * The height is read back in three steps (`resolveRows`): saved rows, former `short`/`normal`/`tall`
 * scale translated, block default. This is what makes a layout saved before this batch open without
 * a gap, and without being rewritten.
 */
export const overviewWidgetSettings = (
  id: OverviewWidgetId,
  pref: WidgetsPref | undefined,
): OverviewResolvedSettings => ({
  ...genericSettings(OVERVIEW_WIDGET_DEFS, id, pref),
  rows: resolveRows(pref?.settings?.[id], OVERVIEW_WIDGET_DEFS[id].rows),
});

export const setOverviewWidgetSetting = (
  id: OverviewWidgetId,
  patch: WidgetSettings,
  pref: WidgetsPref | undefined,
): WidgetsPref => genericSetSetting(id, patch, pref);

/**
 * Saves a size in a single gesture: width and height go together, because the handle sets them
 * together, and one save per axis would double the writes.
 */
export const setOverviewWidgetSize = (
  id: OverviewWidgetId,
  size: WidgetSize,
  pref: WidgetsPref | undefined,
): WidgetsPref => genericSetSetting(id, { span: size.span, rows: size.rows }, pref);

export const reorderOverviewWidgets = (
  activeId: OverviewWidgetId,
  overId: OverviewWidgetId,
  pref: WidgetsPref | undefined,
): WidgetsPref => genericReorder(OVERVIEW_WIDGET_DEFS, activeId, overId, pref);

export const toggleOverviewWidget = (
  id: OverviewWidgetId,
  visible: boolean,
  pref: WidgetsPref | undefined,
): WidgetsPref => genericToggle(OVERVIEW_WIDGET_DEFS, id, visible, pref);
