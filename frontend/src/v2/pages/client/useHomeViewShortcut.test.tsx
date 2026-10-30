// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { useHomeViewShortcut } from './useHomeViewShortcut';

afterEach(cleanup);

/** Presses a key on a given target (the document by default). */
function press(key: string, target: EventTarget = document, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

/**
 * `H` is the only command a guest has on a spatial viewer: it must work without a button, and
 * it must not fire while they type "chair" in their comment.
 */
describe('useHomeViewShortcut', () => {
  it('returns to the original view', () => {
    const home = vi.fn();
    renderHook(() => useHomeViewShortcut(home, true));
    press('h');
    expect(home).toHaveBeenCalledTimes(1);
  });

  it('stays inert until the scene is ready', () => {
    const home = vi.fn();
    renderHook(() => useHomeViewShortcut(home, false));
    press('H');
    expect(home).not.toHaveBeenCalled();
  });

  it('does not reframe while a comment is being typed', () => {
    const home = vi.fn();
    renderHook(() => useHomeViewShortcut(home, true));
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    press('h', textarea);
    expect(home).not.toHaveBeenCalled();
    textarea.remove();
  });

  it('lets browser shortcuts through (Ctrl+H, Cmd+H)', () => {
    const home = vi.fn();
    renderHook(() => useHomeViewShortcut(home, true));
    press('h', document, { ctrlKey: true });
    press('h', document, { metaKey: true });
    expect(home).not.toHaveBeenCalled();
  });

  it('unhooks on unmount, so nothing reacts anymore', () => {
    const home = vi.fn();
    const { unmount } = renderHook(() => useHomeViewShortcut(home, true));
    unmount();
    press('h');
    expect(home).not.toHaveBeenCalled();
  });
});
