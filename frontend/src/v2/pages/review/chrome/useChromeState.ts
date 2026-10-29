// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MediaKind } from '../../../types/api';
import {
  chromePrefsKey,
  defaultChromeState,
  drawerForKind,
  readChromePrefs,
  reconcileChrome,
  type ChromeState,
} from './chromeState';
import { switcherModesFor, type ModeId, type ReviewMode } from './modes';
import { panelsFor } from './panels';
import { chromeCommandFor } from './shortcuts';
import { DEFAULT_TOOL, toolsFor, type ReviewTool } from './tools';

/**
 * Chrome state for a media: preferences read back on mount (rail expanded, panel open, comments
 * visible), ephemeral mode/tool/drawer, and the shortcuts shared by the four viewers — digit keys
 * for the modes, rail tool letters, Escape to return to navigation, `Tab` to fold the dock.
 *
 * The keys are not decided here: they are resolved by `chromeCommandFor`, the registry shared with
 * the shortcut help. This hook applies the command, nothing more.
 *
 * One exception to "applies the command": **during a flight** (right button held in a spatial
 * viewer), the chrome answers nothing. It is one of the four keyboard listeners that coexist on
 * `window`/`document` — it was the only one without a flight guard.
 *
 * Every update goes back through `reconcileChrome`: it is impossible to stay on a tool that does not
 * exist in the current mode.
 */
function initialState(kind: MediaKind): ChromeState {
  const base = defaultChromeState();
  if (typeof window === 'undefined') return base;
  const { drawerOpen, ...prefs } = readChromePrefs(kind, window.localStorage.getItem(chromePrefsKey(kind)));
  return { ...base, ...prefs, drawer: drawerOpen ? drawerForKind(kind) : null };
}

export interface ChromeOptions {
  /**
   * At least one neighbouring version exists. If false, the "Compare" mode leaves the toggle **and**
   * the digit keys — a mode that cannot show anything does not arm.
   */
  canCompare?: boolean;
  /**
   * Modes actually offered by the toggle. The edit mount's player has only one: without this
   * option, the `2` key would send it into a "Compare" mode that its header does not offer.
   */
  modes?: ReviewMode[];
  /**
   * Tools actually on the rail. The mount supplies its own; a tool absent from the rail must not be
   * armable from the keyboard, otherwise the letter arms a tool with no implementation.
   */
  tools?: (mode: ModeId) => ReviewTool[];
  /**
   * Flight in progress in a spatial viewer (right button held). For as long as it lasts, the keyboard
   * belongs to the flight: **no** chrome key answers. Both spatial viewers provide it
   * (`splat.isFlying`, `model3d.isFlying`); flat media have none.
   */
  isFlying?: () => boolean;
}

export function useChromeState(kind: MediaKind, options: ChromeOptions = {}) {
  const { canCompare = true, modes: modesOption, tools: toolsOption, isFlying } = options;
  const [state, setState] = useState<ChromeState>(() => initialState(kind));

  const update = useCallback(
    (patch: Partial<ChromeState>) =>
      setState((prev) => reconcileChrome({ ...prev, ...patch }, kind, canCompare)),
    [kind, canCompare],
  );

  // Media change: we restart from the preferences of this type, with mode and tool at rest.
  // Adjusted during render rather than in an effect — no stale intermediate render.
  const [lastKind, setLastKind] = useState(kind);
  if (lastKind !== kind) {
    setLastKind(kind);
    setState(initialState(kind));
  }

  // Neighbouring versions arrive after the first render: when `canCompare` drops, the state
  // is re-checked instead of waiting for the next action — otherwise one would stay
  // in a "Compare" mode that the toggle has just removed.
  const [lastCanCompare, setLastCanCompare] = useState(canCompare);
  if (lastCanCompare !== canCompare) {
    setLastCanCompare(canCompare);
    setState((prev) => reconcileChrome(prev, kind, canCompare));
  }

  // Preferences are persisted per media type; mode and tool stay ephemeral.
  useEffect(() => {
    const { panel, labels, comments, drawer, drawerH } = state;
    window.localStorage.setItem(
      chromePrefsKey(kind),
      JSON.stringify({ panel, labels, comments, drawerOpen: drawer != null, drawerH }),
    );
  }, [kind, state]);

  const modes = useMemo(
    () => modesOption ?? switcherModesFor(kind, canCompare),
    [modesOption, kind, canCompare],
  );
  const toolsOf = useMemo(() => toolsOption ?? ((mode: ModeId) => toolsFor(mode, kind)), [toolsOption, kind]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Never a shortcut during input (comment, numeric field, search).
      if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // FLIGHT GUARD: right click held is a navigation mode, not a state where one
      // arms tools. `S` (back, in ZQSD as in WASD) armed the Scale gizmo in the middle of a
      // flight; `T`/`R` switched its mode. All keys stay silent, not only the flight ones:
      // changing tool in the middle of a move makes no sense, and the gesture cannot be told
      // apart from a typo.
      if (isFlying?.()) return;

      // A single authority over these keys: the registry. The `reservedKeys` safeguard disappeared
      // with the Cut mode (Phase 50) — it existed because `I`/`O` were both the transport's loop and
      // the cut points, and no tool carries those letters any more.
      const command = chromeCommandFor(e.key, {
        kind,
        mode: state.mode,
        tool: state.tool,
        modes,
        toolsOf,
      });
      if (!command) return;
      e.preventDefault();
      if (command.action === 'panel') {
        // Tab folds the open dock, or reopens the media's first panel.
        update({ panel: state.panel ? null : (panelsFor(kind)[0]?.id ?? null) });
      } else if (command.action === 'rest') {
        update({ tool: DEFAULT_TOOL });
      } else if (command.action === 'mode') {
        update({ mode: command.mode });
      } else {
        update(
          command.mode === state.mode ? { tool: command.tool } : { mode: command.mode, tool: command.tool },
        );
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [kind, modes, toolsOf, isFlying, state.mode, state.panel, state.tool, update]);

  return { state, update };
}
