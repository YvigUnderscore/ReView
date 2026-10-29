// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MessageKey } from '../i18n';

/**
 * Algebra for a composable page: hide, reorder, configure a block.
 *
 * It was born on the Home page (C2), written for it: the functions read `HOME_WIDGETS`,
 * and their types named its five blocks. A project overview needs exactly the same
 * gestures; copying them would have produced two rule sets to fix twice. The registry
 * therefore becomes a **parameter**, and each page keeps its own.
 *
 * Nothing here renders anything: these are pure functions over a preference, which
 * makes them testable without a screen.
 */

/** Width in columns on a twelve-column grid. */
export type WidgetSpan = 3 | 4 | 6 | 8 | 12;
export type WidgetHeight = 'short' | 'normal' | 'tall';
export type WidgetDensity = 'comfortable' | 'compact';
/** Detailed list, thumbnail grid, or a single figure. */
export type WidgetVariant = 'list' | 'grid' | 'kpi';

export interface WidgetSettings {
  span?: WidgetSpan;
  height?: WidgetHeight;
  /**
   * Height in **grid rows**: the project overview and the home page. The ramp
   * of offered heights and their translation into classes live in the size model
   * (`components/widgets/widgetSizing`), not here: only the stored shape is shared.
   *
   * If absent, the page falls back to `height`, then to its own default. This keeps a
   * layout saved before heights existed readable.
   */
  rows?: number;
  density?: WidgetDensity;
  variant?: WidgetVariant;
  /** No header or frame: the block sits flush with the page. This is what makes it "clean". */
  bare?: boolean;
}

/** Saved layout: if absent, the page renders its declaration order. */
export interface WidgetsPref {
  hidden?: string[];
  /** Single order for the page, hidden blocks included (see `reorderWidgets`). */
  order?: string[];
  settings?: Record<string, WidgetSettings>;
}

export interface WidgetDefinition {
  labelKey: MessageKey;
  /** Default width, and widths offered in the settings. */
  span: WidgetSpan;
  spans: WidgetSpan[];
  /** Variants this block can render; a single one means no choice is offered. */
  variants: [WidgetVariant, ...WidgetVariant[]];
}

/** A page registry: block id → its definition. */
export type WidgetRegistry<Id extends string> = Record<Id, WidgetDefinition>;

/** The registry's declaration order = default layout for a new account. */
export const registryIds = <Id extends string>(registry: WidgetRegistry<Id>): Id[] =>
  Object.keys(registry) as Id[];

export const isKnownWidget = <Id extends string>(registry: WidgetRegistry<Id>, value: string): value is Id =>
  value in registry;

/** Hidden blocks (preference filtered to the ids still known). */
export function hiddenWidgets<Id extends string>(
  registry: WidgetRegistry<Id>,
  pref: WidgetsPref | undefined,
): Id[] {
  return (pref?.hidden ?? []).filter((id): id is Id => isKnownWidget(registry, id));
}

/**
 * Effective page order: the saved order first, then blocks never ordered
 * (shipped after the last save) at their declaration position, minus the hidden ones.
 */
export function visibleWidgets<Id extends string>(
  registry: WidgetRegistry<Id>,
  pref: WidgetsPref | undefined,
): Id[] {
  const hidden = new Set(hiddenWidgets(registry, pref));
  const saved = (Array.isArray(pref?.order) ? pref.order : []).filter((id): id is Id =>
    isKnownWidget(registry, id),
  );
  const ordered = [...saved, ...registryIds(registry).filter((id) => !saved.includes(id))];
  return ordered.filter((id) => !hidden.has(id));
}

/** Settings of a block, all filled in: what the frame receives to render. */
export interface ResolvedWidgetSettings {
  span: WidgetSpan;
  variant: WidgetVariant;
  height: WidgetHeight;
  density: WidgetDensity;
  bare: boolean;
}

/** Effective settings of a block: the account's, completed by registry defaults. */
export function widgetSettings<Id extends string>(
  registry: WidgetRegistry<Id>,
  id: Id,
  pref: WidgetsPref | undefined,
): ResolvedWidgetSettings {
  const definition = registry[id];
  const saved = pref?.settings?.[id] ?? {};
  const span = saved.span && definition.spans.includes(saved.span) ? saved.span : definition.span;
  const variant =
    saved.variant && definition.variants.includes(saved.variant) ? saved.variant : definition.variants[0];
  return {
    span,
    variant,
    height: saved.height ?? 'normal',
    density: saved.density ?? 'comfortable',
    bare: saved.bare ?? false,
  };
}

/** Applies a setting to a block; returns the preference patch. */
export function setWidgetSetting(
  id: string,
  patch: WidgetSettings,
  pref: WidgetsPref | undefined,
): WidgetsPref {
  return {
    ...pref,
    settings: { ...pref?.settings, [id]: { ...pref?.settings?.[id], ...patch } },
  };
}

/**
 * Reorders the page after a move; returns the preference patch.
 *
 * The full order is rewritten, hidden blocks included: saving only the visible ones
 * would bring a block that was unhidden back at an arbitrary position.
 */
export function reorderWidgets<Id extends string>(
  registry: WidgetRegistry<Id>,
  activeId: Id,
  overId: Id,
  pref: WidgetsPref | undefined,
): WidgetsPref {
  const visible = visibleWidgets(registry, pref);
  const from = visible.indexOf(activeId);
  const to = visible.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return pref ?? {};
  const next: Id[] = [...visible];
  next.splice(from, 1);
  next.splice(to, 0, activeId);
  const hidden = hiddenWidgets(registry, pref);
  return { ...pref, order: [...next, ...hidden.filter((id) => !next.includes(id))] };
}

/** Hides or shows a block; returns the preference patch. */
export function toggleWidget<Id extends string>(
  registry: WidgetRegistry<Id>,
  id: Id,
  visible: boolean,
  pref: WidgetsPref | undefined,
): WidgetsPref {
  const hidden = new Set<string>(hiddenWidgets(registry, pref));
  if (visible) hidden.delete(id);
  else hidden.add(id);
  return { ...pref, hidden: [...hidden] };
}

/** Restores the page to its original layout. */
export function resetWidgets<Id extends string>(registry: WidgetRegistry<Id>): WidgetsPref {
  return { hidden: [], order: registryIds(registry), settings: {} };
}

/**
 * Grid classes. Written out in full: a Tailwind class built by
 * interpolation (`col-span-${n}`) is purged at build time and produces no style.
 */
const SPAN_CLASS: Record<WidgetSpan, string> = {
  3: 'md:col-span-6 xl:col-span-3',
  4: 'md:col-span-6 xl:col-span-4',
  6: 'md:col-span-6 xl:col-span-6',
  8: 'md:col-span-12 xl:col-span-8',
  12: 'md:col-span-12 xl:col-span-12',
};

const HEIGHT_CLASS: Record<WidgetHeight, string> = {
  short: 'max-h-56 overflow-y-auto',
  normal: '',
  tall: 'min-h-96',
};

export const spanClass = (span: WidgetSpan): string => SPAN_CLASS[span];
export const heightClass = (height: WidgetHeight): string => HEIGHT_CLASS[height];
