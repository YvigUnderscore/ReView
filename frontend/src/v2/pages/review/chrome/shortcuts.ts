// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MediaKind } from '../../../types/api';
import type { MessageKey } from '../../../i18n';
import { modesFor, switcherModesFor, type ModeId, type ReviewMode } from './modes';
import {
  DEFAULT_TOOL,
  toolSearchOrder,
  toolsFor,
  viewActionsFor,
  type ReviewTool,
  type ToolId,
} from './tools';

/**
 * Review shortcut registry — **single source of truth**.
 *
 * Two lists used to exist: the one the handlers apply, and the one the help
 * (`components/ShortcutsHelp`) recited. They had diverged — the help omitted `Tab`, `+`/`-`, the
 * A/B offset brackets, the camera bookmarks and half of the rail tools, while promising a "Zoom"
 * tool that armed nothing. This file therefore carries both roles:
 *
 *  1. `chromeCommandFor` **resolves** a chrome keystroke (mode, tool, dock, reset) — this is what
 *     `useChromeState` applies, and nothing else decides these keys;
 *  2. `reviewShortcutGroups` **describes** every review shortcut for the help, which derives from it
 *     instead of keeping its own copy.
 *
 * Tool keys and the two view actions are **derived from `tools.ts`**: they are never copied, or the
 * divergence would come back through the service door. Each entry names the handler that runs it
 * (`handler`): an entry without a handler is a dead shortcut, and the registry test rejects it.
 */

/**
 * A key as it is displayed. `char` is a technical character, rendered in a `<kbd>`: a letter, a
 * digit, a symbol, or a modifier name identical in all languages (`Ctrl`, `Alt`, `Tab`). Any key
 * name that gets translated — Space, Shift, Delete, right click, ZQSD — goes through `nameKey`,
 * never through `char`: the thirteen other catalogues must be able to render it.
 */
export type KeyToken = { char: string } | { nameKey: MessageKey };

export interface ReviewShortcut {
  /** Keys of the shortcut, in display order. */
  keys: KeyToken[];
  labelKey: MessageKey;
  /** Hook or component that actually runs the gesture. */
  handler: string;
}

export interface ShortcutGroup {
  titleKey: MessageKey;
  shortcuts: ReviewShortcut[];
}

const ch = (char: string): KeyToken => ({ char });
const named = (nameKey: MessageKey): KeyToken => ({ nameKey });

/** Keys identical everywhere: these are the only ones written as plain text in a `char`. */
export const NEUTRAL_KEY_NAMES = ['Ctrl', 'Alt', 'Tab'];

// ───────────────────────────── keystroke resolution ─────────────────────────────

/** What a keystroke asks of the chrome. `null` = the key is not ours. */
export type ChromeCommand =
  | { action: 'panel' }
  | { action: 'rest' }
  | { action: 'mode'; mode: ModeId }
  | { action: 'tool'; mode: ModeId; tool: ToolId };

export interface ChromeKeyContext {
  kind: MediaKind;
  mode: ModeId;
  tool: ToolId;
  /** Modes offered by the toggle, in digit-key order. */
  modes: ReviewMode[];
  /**
   * Tools actually on the rail for a mode. Defaults to those of the media type; the edit mount
   * passes its own — a tool absent from the rail must not be armable from the keyboard.
   */
  toolsOf: (mode: ModeId) => ReviewTool[];
}

/**
 * Resolves a chrome keystroke. Pure function: the guards (input in progress, modifiers, open
 * dialog) stay with the handler, which alone knows the event.
 */
export function chromeCommandFor(key: string, ctx: ChromeKeyContext): ChromeCommand | null {
  if (key === 'Tab') return { action: 'panel' };
  // Escape only does something when there is something to do: otherwise the key goes back to the other
  // listeners (leaving theater mode, deselecting a comment).
  if (key === 'Escape') return ctx.tool === DEFAULT_TOOL ? null : { action: 'rest' };

  const index = Number(key) - 1;
  if (Number.isInteger(index) && index >= 0 && index < ctx.modes.length)
    return { action: 'mode', mode: ctx.modes[index].value };

  // Tool letter: the current mode first, otherwise the other modes — arming the tool of another
  // mode switches to it (T/R/S bring back "Clean up", a drawing tool arms annotation),
  // instead of doing nothing.
  const letter = key.toUpperCase();
  if (letter.length !== 1) return null;
  for (const mode of toolSearchOrder(ctx.kind, ctx.mode)) {
    const tool = ctx.toolsOf(mode).find((t) => t.key === letter);
    if (tool) return { action: 'tool', mode, tool: tool.id };
  }
  return null;
}

// ─────────────────────────────── description for the help ───────────────────────────────

const CHROME = 'useChromeState';

/** Rows of the tools of a media type — their keys come from `tools.ts`. */
function toolRows(kind: MediaKind): ReviewShortcut[] {
  const rows: ReviewShortcut[] = [];
  // A tool recurs in several modes (`nav` everywhere, focus in exploration and
  // in staging): one row per key + label pair. The translation key is
  // never concatenated into an identifier — a key has no business in an assembled string.
  const seen = new Map<string, Set<MessageKey>>();
  for (const mode of modesFor(kind))
    for (const tool of toolsFor(mode.value, kind)) {
      const labels = seen.get(tool.key) ?? new Set<MessageKey>();
      if (labels.has(tool.labelKey)) continue;
      seen.set(tool.key, labels.add(tool.labelKey));
      rows.push({ keys: [ch(tool.key)], labelKey: tool.labelKey, handler: CHROME });
    }
  return rows;
}

/** The two view actions (`F`, `H`) with the media type's label. */
function viewRows(kind: MediaKind, handler: string): ReviewShortcut[] {
  return viewActionsFor(kind).map((a) => ({ keys: [ch(a.key)], labelKey: a.labelKey, handler }));
}

/** Chrome shortcuts, shared by the four viewers. */
function chromeRows(): ReviewShortcut[] {
  return [
    {
      // The digit keys follow the mode toggle: at most three modes (spatial),
      // two on a flat media. Each segment's tooltip carries the same number.
      keys: switcherModesFor('SPLAT').map((_, i) => ch(String(i + 1))),
      labelKey: 'review.mode',
      handler: CHROME,
    },
    { keys: [ch('Tab')], labelKey: 'shortcuts.dock', handler: CHROME },
    { keys: [named('common.escKey')], labelKey: 'shortcuts.restTool', handler: CHROME },
    { keys: [ch('Ctrl'), ch('V')], labelKey: 'shortcuts.pasteReference', handler: 'ReviewCanvasRefs' },
    // Two rows rather than one "Ctrl + Z / Y": each key is written as it is pressed.
    // A single handler for all the review histories since batch 9 (annotation in
    // progress, 3D brush, splat editor): it serves the highest-priority one that has a step to undo.
    { keys: [ch('Ctrl'), ch('Z')], labelKey: 'common.undo', handler: 'useUndoScope' },
    { keys: [ch('Ctrl'), ch('Y')], labelKey: 'common.redo', handler: 'useUndoScope' },
    // Right-click carries the actions in ALL FOUR viewers since batch 8: briefly, it opens the
    // menu; held, it steals (spatial only). The two gestures are told apart in
    // `viewer/contextGesture`, and flight keeps its own row further down.
    {
      keys: [named('key.rightClick')],
      labelKey: 'shortcuts.contextMenuBrief',
      handler: 'useSpatialContextMenu',
    },
  ];
}

/** Video player transport and A/B comparison offset. */
function videoRows(): ReviewShortcut[] {
  const transport = 'useReviewShortcuts';
  return [
    { keys: [named('key.space')], labelKey: 'shortcuts.playPause', handler: transport },
    { keys: [ch('←'), ch('→')], labelKey: 'shortcuts.frameStep', handler: transport },
    { keys: [named('key.shift'), ch('←/→')], labelKey: 'shortcuts.frameStep10', handler: transport },
    { keys: [ch('J')], labelKey: 'shortcuts.playBackward', handler: transport },
    { keys: [ch('K')], labelKey: 'shortcuts.pause', handler: transport },
    { keys: [ch('L')], labelKey: 'shortcuts.playForward', handler: transport },
    { keys: [ch('I'), ch('O')], labelKey: 'shortcuts.loopPoints', handler: transport },
    { keys: [ch('M')], labelKey: 'shortcuts.commentAtFrame', handler: transport },
    { keys: [ch('['), ch(']')], labelKey: 'shortcuts.compareOffset', handler: transport },
    {
      keys: [named('key.shift'), ch('\\')],
      labelKey: 'shortcuts.compareOffsetReset',
      handler: transport,
    },
  ];
}

/** View of the two flat viewers: fit, 1:1, no zoom. */
function flatRows(): ReviewShortcut[] {
  return [
    ...toolRows('VIDEO'),
    ...viewRows('VIDEO', 'useViewShortcuts'),
    { keys: [ch('+'), ch('-')], labelKey: 'shortcuts.zoomStep', handler: 'useViewportZoom' },
  ];
}

/** Spatial viewers: tools, flight, framing, editing, bookmarks and camera transport. */
function spatialRows(): ReviewShortcut[] {
  const camera = 'useCameraShortcuts';
  return [
    ...toolRows('SPLAT'),
    {
      keys: [named('key.rightClick'), named('key.wasd')],
      labelKey: 'shortcuts.splatFly',
      handler: 'flyControls',
    },
    ...viewRows('SPLAT', 'useFrameShortcuts'),
    { keys: [named('key.delete')], labelKey: 'shortcuts.deleteSelection', handler: 'useEditorShortcuts' },
    // Same key, two viewers: on a splat it removes the selected points, on a
    // USD scene it hides the designated prim — an override, never a file deletion.
    { keys: [named('key.delete')], labelKey: 'shortcuts.hidePrim', handler: 'useSceneEditShortcuts' },
    {
      keys: [ch('Alt'), ch('1'), ch('9')],
      labelKey: 'shortcuts.cameraBookmark',
      handler: 'useModel3DBookmarks',
    },
    { keys: [named('key.space')], labelKey: 'shortcuts.cameraPlay', handler: camera },
    { keys: [ch('K')], labelKey: 'shortcuts.cameraKey', handler: camera },
    { keys: [ch('←'), ch('→')], labelKey: 'shortcuts.cameraKeyNav', handler: camera },
    {
      keys: [named('key.home'), named('key.end')],
      labelKey: 'shortcuts.cameraBounds',
      handler: camera,
    },
  ];
}

/**
 * All the review shortcut groups, in the help's display order. The "Navigation" section, however,
 * stays driven by `lib/shortcutRegistry`: its keys are reconfigurable and persisted on the account,
 * which these shortcuts are not.
 */
export function reviewShortcutGroups(): ShortcutGroup[] {
  return [
    { titleKey: 'shortcuts.allTypes', shortcuts: chromeRows() },
    { titleKey: 'shortcuts.videoReview', shortcuts: videoRows() },
    { titleKey: 'shortcuts.flatTools', shortcuts: flatRows() },
    { titleKey: 'shortcuts.spatialTools', shortcuts: spatialRows() },
  ];
}
