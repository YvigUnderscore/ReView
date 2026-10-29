// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { canSwitchMode, modesFor, switcherModesFor } from '../chrome/modes';
import { reconcileChrome, defaultChromeState } from '../chrome/chromeState';
import { chromeCommandFor, type ChromeKeyContext } from '../chrome/shortcuts';
import { DEFAULT_TOOL, toolsFor } from '../chrome/tools';
import { hasMessage } from '../../../i18n';
import { splatEditRail, splatEditTools, splatSwitcherModes, splatToolsFor } from './splatChrome';

/**
 * Switch and rail of the splat. "Staging" and "Clean up" left the header in lot 12; in lot 13,
 * the editing tools **return to the rail** (they had ended up in a viewer popover, whereas the
 * request was to remove the segment, not to tuck the tools away).
 *
 * What is checked here is exactly what these two moves must preserve: the modes remain valid,
 * all their tools stay reachable by mouse AND keyboard, and no letter becomes orphaned. This is
 * the defect lot 4 had settled (a tool removed from the rail that still armed); it does not reopen
 * through the switch or the rail.
 */

/** Typing context of a splat viewer: the rail actually offered, editor mounted or not. */
const ctx = (mode: ChromeKeyContext['mode'] = 'explore', showEdit = true): ChromeKeyContext => ({
  kind: 'SPLAT',
  mode,
  tool: 'nav',
  modes: splatSwitcherModes(),
  toolsOf: (m) => splatToolsFor(m, showEdit),
});

describe('splatSwitcherModes — the splat switch is removed', () => {
  it('no longer offers "Staging" or "Clean up"', () => {
    const values = splatSwitcherModes().map((m) => m.value);
    expect(values).not.toContain('stage');
    expect(values).not.toContain('clean');
    // The common spatial chrome still knows them: it is the splat that departs from it.
    expect(switcherModesFor('SPLAT').map((m) => m.value)).toContain('clean');
  });

  it('has only "Explore" left: a single segment switches to nothing', () => {
    expect(splatSwitcherModes().map((m) => m.value)).toEqual(['explore']);
    expect(canSwitchMode('ADMIN', splatSwitcherModes().length)).toBe(false);
  });

  it('leaves both modes VALID: nothing is deleted, only the path changes', () => {
    // `reconcileChrome` judges on the full list: an editing tool armed there stays armed,
    // otherwise removing the segment would have taken the tool with it.
    expect(modesFor('SPLAT').map((m) => m.value)).toEqual(
      expect.arrayContaining(['stage', 'clean', 'annotate']),
    );
    const state = { ...defaultChromeState(), mode: 'clean' as const, tool: 'sel-lasso' as const };
    expect(reconcileChrome(state, 'SPLAT')).toBe(state);
  });

  it('removes both segments from the number keys: an absent segment cannot be armed', () => {
    expect(chromeCommandFor('1', ctx())).toEqual({ action: 'mode', mode: 'explore' });
    expect(chromeCommandFor('2', ctx())).toBeNull();
    expect(chromeCommandFor('3', ctx())).toBeNull();
  });
});

describe('splatEditTools — the editing tools return to the rail, not through the trapdoor', () => {
  it('lists the tools of the "Clean up" mode, excluding the rest state', () => {
    const ids = splatEditTools().map((tool) => tool.id);
    // Select, delete (via the mask), move, scale: the request.
    expect(ids).toEqual(['sel-rect', 'sel-lasso', 'sel-brush', 'volume', 'translate', 'rotate', 'scale']);
    expect(ids).not.toContain(DEFAULT_TOOL);
    for (const tool of splatEditTools()) expect(hasMessage(tool.labelKey)).toBe(true);
  });

  it('copies nothing: it is the `toolsFor` list, minus the rest state', () => {
    expect(splatEditTools()).toEqual(toolsFor('clean', 'SPLAT').filter((t) => t.id !== DEFAULT_TOOL));
  });

  it('each keeps its letter, from exploration as from editing', () => {
    for (const tool of splatEditTools())
      for (const mode of ['explore', 'clean'] as const)
        expect(chromeCommandFor(tool.key, ctx(mode))).toEqual({
          action: 'tool',
          mode: 'clean',
          tool: tool.id,
        });
  });

  it('forgets no armable tool: no orphaned letter outside the rail', () => {
    // The reverse of the previous test: everything the keyboard can arm in "Clean up" must
    // be found with the mouse. A tool on the keyboard with no button is exactly the defect we
    // refuse to reopen, in the other direction.
    const shown = new Set(splatEditTools().map((tool) => tool.id));
    for (const tool of toolsFor('clean', 'SPLAT'))
      if (tool.id !== DEFAULT_TOOL) expect(shown.has(tool.id)).toBe(true);
  });
});

describe('splatEditRail — the second rail group', () => {
  it('arms "Clean up" and bears the title the popover had', () => {
    const rail = splatEditRail(true)!;
    expect(rail.mode).toBe('clean');
    expect(rail.titleKey).toBe('viewer.edit.title');
    expect(hasMessage(rail.titleKey)).toBe(true);
    expect(rail.tools).toEqual(splatEditTools());
  });

  it('does not exist without a mounted editor: these tools would write nowhere', () => {
    expect(splatEditRail(false)).toBeUndefined();
  });
});

describe('splatToolsFor — the rail and the keyboard read the same list', () => {
  it('renders the rail of the requested mode', () => {
    expect(splatToolsFor('explore', true)).toEqual(toolsFor('explore', 'SPLAT'));
    expect(splatToolsFor('annotate', false)).toEqual(toolsFor('annotate', 'SPLAT'));
  });

  it('closes "Clean up" on the KEYBOARD when the rail group has disappeared', () => {
    // The missing half: without it, `B`/`L`/`T`… still armed tools that nothing shows any more,
    // and which write nowhere.
    expect(splatToolsFor('clean', false)).toEqual([]);
    expect(splatToolsFor('clean', true).length).toBeGreaterThan(1);
    for (const tool of splatEditTools())
      expect(chromeCommandFor(tool.key, ctx('explore', false))).not.toEqual(
        expect.objectContaining({ mode: 'clean' }),
      );
  });

  it('leaves the surface brush intact without an editor: it annotates, it does not edit', () => {
    expect(chromeCommandFor('p', ctx('explore', false))).toEqual({
      action: 'tool',
      mode: 'annotate',
      tool: 'paint',
    });
  });
});
