// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MediaKind } from '@/v2/types/api';
import { DEFAULT_MODE, allowedModesFor, isSpatialKind, type ModeId } from './modes';
import { panelsFor, type PanelId } from './panels';
import { DEFAULT_TOOL, toolsFor, type ToolId } from './tools';

/**
 * Review chrome state — a single source per workspace, split by domain. Domain hooks
 * (annotations, camera, splat…) keep their own state; this only describes what drives the five
 * chrome slots.
 *
 * `labels`, `panel` and `comments` are **preferences**: persisted per user and per media type.
 * `mode`, `tool` and `drawer` are ephemeral and reset to their defaults.
 */
export type DrawerId = 'strip' | 'curves';

export interface ChromeState {
  mode: ModeId;
  tool: ToolId;
  /** `null` = dock folded onto its tab strip. */
  panel: PanelId | null;
  /** Rail expanded: labels and shortcuts visible next to the icons. */
  labels: boolean;
  comments: boolean;
  drawer: DrawerId | null;
  /** Drawer height (px) — resizable, persisted. */
  drawerH: number;
}

/** Drawer height bounds (resize handle). */
export const DRAWER_MIN_H = 120;
export const DRAWER_MAX_H = 480;
export const DRAWER_DEFAULT_H = 168;

/** The drawer anchored under the transport: animation curves in 3D, filmstrip in video/image. */
export function drawerForKind(kind: MediaKind): DrawerId {
  return isSpatialKind(kind) ? 'curves' : 'strip';
}

export function defaultChromeState(): ChromeState {
  return {
    mode: DEFAULT_MODE,
    tool: DEFAULT_TOOL,
    // Dock folded on first opening: the media comes before the settings. The user
    // opens it when needed, and their preference is remembered per media type.
    panel: null,
    labels: false,
    comments: true,
    drawer: null,
    drawerH: DRAWER_DEFAULT_H,
  };
}

/**
 * Brings a state back to what actually exists for this media and mode: a tool unknown to the mode
 * → `nav`, a panel absent from the dock → first panel, a drawer from another family → closed.
 * Called on mode change as well as on media change; returns the original object when nothing
 * moves, to avoid a needless render.
 *
 * `canCompare` false removes "Compare" from the valid modes: without a neighbouring version,
 * staying there would show no comparison.
 */
export function reconcileChrome(state: ChromeState, kind: MediaKind, canCompare = true): ChromeState {
  const mode = allowedModesFor(kind, canCompare).some((m) => m.value === state.mode)
    ? state.mode
    : DEFAULT_MODE;
  const tool = toolsFor(mode, kind).some((t) => t.id === state.tool) ? state.tool : DEFAULT_TOOL;
  const panels = panelsFor(kind);
  const panel =
    state.panel === null || panels.some((p) => p.id === state.panel) ? state.panel : (panels[0]?.id ?? null);
  const drawer = state.drawer === drawerForKind(kind) ? state.drawer : null;

  if (mode === state.mode && tool === state.tool && panel === state.panel && drawer === state.drawer)
    return state;
  return { ...state, mode, tool, panel, drawer };
}

/** Preferences persistence key — one per media type. */
export function chromePrefsKey(kind: MediaKind): string {
  return `review.chrome.${kind}`;
}

/**
 * Persisted subset of the state: the preferences, never the current mode or tool. The drawer is
 * remembered by its open state (`drawerOpen`) — the drawer's identity depends on the media
 * (`drawerForKind`), not on the preference.
 */
export type ChromePrefs = Pick<ChromeState, 'panel' | 'labels' | 'comments' | 'drawerH'> & {
  drawerOpen: boolean;
};

export function readChromePrefs(kind: MediaKind, raw: string | null): ChromePrefs {
  const base = defaultChromeState();
  const fallback: ChromePrefs = {
    panel: base.panel,
    labels: base.labels,
    comments: base.comments,
    drawerOpen: false,
    drawerH: base.drawerH,
  };
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<ChromePrefs>;
    const known = panelsFor(kind);
    return {
      panel:
        parsed.panel === null || known.some((p) => p.id === parsed.panel)
          ? (parsed.panel ?? null)
          : fallback.panel,
      labels: typeof parsed.labels === 'boolean' ? parsed.labels : fallback.labels,
      comments: typeof parsed.comments === 'boolean' ? parsed.comments : fallback.comments,
      drawerOpen: typeof parsed.drawerOpen === 'boolean' ? parsed.drawerOpen : fallback.drawerOpen,
      drawerH:
        typeof parsed.drawerH === 'number' && Number.isFinite(parsed.drawerH)
          ? Math.min(DRAWER_MAX_H, Math.max(DRAWER_MIN_H, parsed.drawerH))
          : fallback.drawerH,
    };
  } catch {
    // Corrupt preference (manual edit, old format): start again from the defaults.
    return fallback;
  }
}
