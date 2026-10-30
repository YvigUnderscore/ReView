// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useViewShortcuts, type ViewCommands } from './useViewShortcuts';
import { viewActionsFor } from '../chrome/tools';

/**
 * `F` and `H` on the flat viewers. Both view actions were **declared** by the rail
 * (`action.fitMedia`, `action.resetMedia`) and wired nowhere: the two letters did nothing, neither
 * on an image nor on a video.
 */
const mount = (commands: ViewCommands | null) => renderHook(() => useViewShortcuts(commands));

const press = (key: string, init: KeyboardEventInit = {}) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });

const spies = () => ({ fit: vi.fn<() => void>(), oneToOne: vi.fn<() => void>() }) satisfies ViewCommands;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('useViewShortcuts', () => {
  it('uses exactly the keys the rail announces', () => {
    expect(viewActionsFor('VIDEO').map((a) => a.key)).toEqual(['F', 'H']);
    expect(viewActionsFor('IMAGE').map((a) => a.key)).toEqual(['F', 'H']);
  });

  it('F fits to screen', () => {
    const cmd = spies();
    mount(cmd);
    press('f');
    expect(cmd.fit).toHaveBeenCalledTimes(1);
    expect(cmd.oneToOne).not.toHaveBeenCalled();
  });

  it('H returns to actual size', () => {
    const cmd = spies();
    mount(cmd);
    press('h');
    expect(cmd.oneToOne).toHaveBeenCalledTimes(1);
  });

  it('ignores modified keystrokes — Ctrl+F remains the browser search', () => {
    const cmd = spies();
    mount(cmd);
    press('f', { ctrlKey: true });
    press('h', { shiftKey: true });
    expect(cmd.fit).not.toHaveBeenCalled();
    expect(cmd.oneToOne).not.toHaveBeenCalled();
  });

  it('disarmed (`null`), responds to nothing — comparison panes do not duplicate the gesture', () => {
    const cmd = spies();
    mount(null);
    press('f');
    expect(cmd.fit).not.toHaveBeenCalled();
  });
});
