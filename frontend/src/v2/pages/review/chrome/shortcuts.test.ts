// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { hasMessage } from '@/v2/i18n';
import { modesFor, switcherModesFor, type ModeId } from './modes';
import { toolsFor, viewActionsFor } from './tools';
import {
  NEUTRAL_KEY_NAMES,
  chromeCommandFor,
  reviewShortcutGroups,
  type ChromeKeyContext,
  type KeyToken,
} from './shortcuts';
import type { MediaKind } from '@/v2/types/api';

const KINDS: MediaKind[] = ['VIDEO', 'IMAGE', 'MODEL_3D', 'SPLAT'];

/** Keystroke context of a review viewer: the full rail of the media type. */
const ctx = (kind: MediaKind, mode: ModeId = 'explore', tool = 'nav'): ChromeKeyContext => ({
  kind,
  mode,
  tool: tool as ChromeKeyContext['tool'],
  modes: switcherModesFor(kind),
  toolsOf: (m) => toolsFor(m, kind),
});

describe('chromeCommandFor — one keystroke, one command', () => {
  it('Tab toggles the dock, Escape only answers when there is a tool to disarm', () => {
    expect(chromeCommandFor('Tab', ctx('VIDEO'))).toEqual({ action: 'panel' });
    expect(chromeCommandFor('Escape', ctx('VIDEO'))).toBeNull();
    expect(chromeCommandFor('Escape', ctx('VIDEO', 'annotate', 'draw'))).toEqual({ action: 'rest' });
  });

  it('the digits follow the mode toggle, and stop with it', () => {
    const modes = switcherModesFor('VIDEO');
    expect(chromeCommandFor('1', ctx('VIDEO'))).toEqual({ action: 'mode', mode: modes[0].value });
    expect(chromeCommandFor('2', ctx('VIDEO'))).toEqual({ action: 'mode', mode: modes[1].value });
    // Two modes in video: the third digit arms nothing.
    expect(chromeCommandFor('3', ctx('VIDEO'))).toBeNull();
    expect(chromeCommandFor('0', ctx('VIDEO'))).toBeNull();
  });

  it('a tool letter switches to the mode that carries it', () => {
    expect(chromeCommandFor('d', ctx('VIDEO'))).toEqual({ action: 'tool', mode: 'annotate', tool: 'draw' });
    expect(chromeCommandFor('T', ctx('SPLAT'))).toEqual({ action: 'tool', mode: 'clean', tool: 'translate' });
  });

  /**
   * `G` used to arm the polygon AND start the global navigation sequence (`g` then a letter).
   * The leader is not reconfigurable, so the tool changed key: `G` must no longer arm anything
   * in any viewer.
   */
  it('G no longer arms any tool: the key belongs to the navigation leader', () => {
    for (const kind of KINDS)
      for (const mode of modesFor(kind)) expect(chromeCommandFor('g', ctx(kind, mode.value))).toBeNull();
    expect(chromeCommandFor('p', ctx('VIDEO'))).toEqual({
      action: 'tool',
      mode: 'annotate',
      tool: 'polygon',
    });
  });

  it('removed tools are no longer armable from the keyboard', () => {
    // "Zoom" (Z) on flat media, "Region" (B) in 3D: hidden from the rail by every
    // viewer, so without an implementation — and yet armable from the keyboard.
    for (const kind of ['VIDEO', 'IMAGE'] as const) expect(chromeCommandFor('z', ctx(kind))).toBeNull();
    // "Wipe bar" (W): the "Compare" mode already arms the wipe, the tool repeated the mode
    // from the rail without arming anything more. The key must therefore no longer reach anything,
    // from any mode — exactly the defect the registry settled.
    for (const kind of ['VIDEO', 'IMAGE'] as const)
      for (const mode of modesFor(kind)) expect(chromeCommandFor('w', ctx(kind, mode.value))).toBeNull();
    expect(chromeCommandFor('b', ctx('MODEL_3D'))).toBeNull();
    // The splat keeps its rectangle selection on the same letter.
    expect(chromeCommandFor('b', ctx('SPLAT'))).toEqual({
      action: 'tool',
      mode: 'clean',
      tool: 'sel-rect',
    });
  });

  /**
   * REWRITTEN knowingly (Phase 50, batch 13). The previous case locked in "the 3D painter stays on
   * the splat" — the `kind: 'SPLAT'` restriction set in batch 8, although the request said "in the
   * 3D/splat annotation tools". It therefore never closed a hole: it recorded a gap, and on a model
   * the "Annotate" mode only offered navigation and the pin. The brush and its eraser now serve both
   * spatial types.
   */
  it('the surface brush and its eraser arm on BOTH spatial types', () => {
    for (const kind of ['SPLAT', 'MODEL_3D'] as const) {
      expect(chromeCommandFor('p', ctx(kind, 'annotate'))).toEqual({
        action: 'tool',
        mode: 'annotate',
        tool: 'paint',
      });
      expect(chromeCommandFor('x', ctx(kind, 'annotate'))).toEqual({
        action: 'tool',
        mode: 'annotate',
        tool: 'paint-erase',
      });
      // And from any mode: the letter switches to the one carrying the tool.
      expect(chromeCommandFor('p', ctx(kind, 'explore'))).toEqual({
        action: 'tool',
        mode: 'annotate',
        tool: 'paint',
      });
    }
  });

  it('a model\'s "Annotate" mode no longer reduces to navigation and the pin', () => {
    const ids = toolsFor('annotate', 'MODEL_3D').map((tool) => tool.id);
    expect(ids).toContain('paint');
    expect(ids).toContain('paint-erase');
    // The cloud tools, however, remain specific to the splat: they hide splats.
    expect(toolsFor('clean', 'MODEL_3D').map((tool) => tool.id)).not.toContain('sel-rect');
  });

  it('no rail tool is without a letter, and no letter serves two tools of a mode', () => {
    // The defect settled in batch 4: an orphan letter, or two tools of the same mode on the same
    // key — the second would never have answered, `chromeCommandFor` returning the first.
    for (const kind of KINDS)
      for (const mode of modesFor(kind)) {
        const tools = toolsFor(mode.value, kind);
        const keys = tools.map((tool) => tool.key);
        expect(new Set(keys).size).toBe(keys.length);
        for (const tool of tools) expect(tool.key).toMatch(/^[A-Z]$/);
      }
  });

  /**
   * Shape move used to be on `M`, the video transport's key: the transport kept it by stopping the
   * event bubbling, and the rail button announced a shortcut that, on a video, never armed anything.
   * The tool moved to `S`.
   */
  it('M belongs to the transport: the letter arms no tool, S moves the shapes', () => {
    for (const kind of ['VIDEO', 'IMAGE'] as const) {
      expect(chromeCommandFor('m', ctx(kind))).toBeNull();
      expect(chromeCommandFor('s', ctx(kind))).toEqual({
        action: 'tool',
        mode: 'annotate',
        tool: 'shape-move',
      });
    }
  });

  it('no flat tool key duplicates the video transport', () => {
    // Space, J/K/L, I/O (loop), M (comment), [ ] and \ (A/B offset) belong to the
    // player; `G` to the global navigation leader.
    const taken = ['J', 'K', 'L', 'I', 'O', 'M', 'G', '[', ']', '\\'];
    for (const kind of ['VIDEO', 'IMAGE'] as const)
      for (const mode of modesFor(kind))
        for (const tool of toolsFor(mode.value, kind)) expect(taken).not.toContain(tool.key);
  });

  it('the Compare mode rail only has the idle state left', () => {
    // The compare mode, and it alone, loses its tool: "Annotate" keeps its whole stroke set.
    for (const kind of ['VIDEO', 'IMAGE'] as const) {
      expect(toolsFor('compare', kind).map((tool) => tool.id)).toEqual(['nav']);
      expect(toolsFor('annotate', kind).length).toBeGreaterThan(1);
    }
  });

  it('a restricted rail restricts the keyboard — the edit mount has neither compare nor wipe', () => {
    const montage: ChromeKeyContext = {
      kind: 'VIDEO',
      mode: 'explore',
      tool: 'nav',
      modes: switcherModesFor('VIDEO').slice(0, 1),
      toolsOf: (m) => toolsFor(m, 'VIDEO').filter((t) => t.id === 'nav' || m === 'annotate'),
    };
    expect(chromeCommandFor('2', montage)).toBeNull();
    expect(chromeCommandFor('w', montage)).toBeNull();
    expect(chromeCommandFor('v', montage)).toEqual({ action: 'tool', mode: 'explore', tool: 'nav' });
  });
});

const groups = reviewShortcutGroups();
const allShortcuts = groups.flatMap((g) => g.shortcuts);
const charsOf = (keys: KeyToken[]) => keys.flatMap((k) => ('char' in k ? [k.char] : []));

describe('shortcut registry — the help can no longer diverge from the code', () => {
  it('each entry names the handler that executes it', () => {
    expect(allShortcuts.length).toBeGreaterThan(20);
    for (const s of allShortcuts) expect(s.handler).toMatch(/^[A-Za-z][A-Za-z0-9]*$/);
  });

  it('all rail tool keys are described, without inventing any', () => {
    // Derived from `tools.ts`: every rail letter appears in the registry, and the registry has no
    // tool the rail does not offer. This is where the help and the code used to diverge.
    const described = new Set(allShortcuts.map((s) => s.labelKey));
    for (const kind of KINDS)
      for (const mode of modesFor(kind))
        for (const tool of toolsFor(mode.value, kind)) expect(described.has(tool.labelKey)).toBe(true);
    for (const kind of KINDS)
      for (const action of viewActionsFor(kind)) expect(described.has(action.labelKey)).toBe(true);
  });

  it('all labels and key names exist in the English catalogue', () => {
    for (const g of groups) {
      expect(hasMessage(g.titleKey)).toBe(true);
      for (const s of g.shortcuts) {
        expect(hasMessage(s.labelKey)).toBe(true);
        for (const key of s.keys) if ('nameKey' in key) expect(hasMessage(key.nameKey)).toBe(true);
      }
    }
  });

  /**
   * The i18n rule's safeguard: a key name that gets translated ("Space", "Shift", "Delete",
   * "Right click", "ZQSD") must go through `nameKey`. A `char` can therefore only be a character,
   * or one of the three modifiers identical across all languages.
   */
  it('no translatable key name is written as plain text', () => {
    for (const char of allShortcuts.flatMap((s) => charsOf(s.keys)))
      expect(NEUTRAL_KEY_NAMES.includes(char) || /^[^\p{L}]*\p{L}?[^\p{L}]*$/u.test(char)).toBe(true);
  });

  it('one label per row in a group — the help uses it as list identity', () => {
    for (const g of groups) {
      const labels = g.shortcuts.map((s) => s.labelKey);
      expect(new Set(labels).size).toBe(labels.length);
    }
  });
});
