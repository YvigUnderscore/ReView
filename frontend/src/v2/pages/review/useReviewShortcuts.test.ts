// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, cleanup, renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCompareOffset } from './compareOffset';
import { useReviewShortcuts } from './useReviewShortcuts';

vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }));

/** Minimal player: the hook only calls `pause`, `play` and reads `paused`. */
const fakeVideo = () =>
  ({
    paused: true,
    currentTime: 0,
    playbackRate: 1,
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    readyState: 4,
  }) as unknown as HTMLVideoElement;

const mount = (video: HTMLVideoElement, onMarker = vi.fn(), fps = 24) => {
  const ref = createRef<HTMLVideoElement>();
  (ref as { current: unknown }).current = video;
  const view = renderHook(() => useReviewShortcuts({ videoRef: ref, fps, onMarker }));
  return { ...view, onMarker };
};

const press = (init: KeyboardEventInit) =>
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  });

beforeEach(() => useCompareOffset.getState().reset());
afterEach(() => {
  // `globals` is not enabled in the vitest config: teardown is not automatic, and the keyboard
  // listeners of one test would survive the next.
  cleanup();
  vi.clearAllMocks();
});

describe('M key — the transport wins over the tool rail', () => {
  it('pauses and opens the composer at the current frame', () => {
    const video = fakeVideo();
    const { onMarker } = mount(video);
    press({ key: 'm' });
    expect(video.pause).toHaveBeenCalled();
    expect(onMarker).toHaveBeenCalledTimes(1);
  });

  it('no longer reaches the rail: the keystroke does not switch to Annotate mode', () => {
    // The rail listens on `window`; this hook, on `document`. Bubbling reaches the second first,
    // and stops there — that is what settles the collision with the `shape-move` tool.
    const railHeard: string[] = [];
    const rail = (e: KeyboardEvent) => railHeard.push(e.key);
    window.addEventListener('keydown', rail);
    const video = fakeVideo();
    mount(video);
    press({ key: 'm' });
    expect(railHeard).toEqual([]);
    // The other letters still reach the rail: only M is removed from it.
    press({ key: 'd' });
    expect(railHeard).toEqual(['d']);
    window.removeEventListener('keydown', rail);
  });
});

describe('brackets — offset of the A/B comparison', () => {
  it('offsets by one frame per keystroke, in both directions', () => {
    mount(fakeVideo());
    press({ code: 'BracketRight', key: ']' });
    expect(useCompareOffset.getState().frames).toBe(1);
    press({ code: 'BracketRight', key: ']' });
    expect(useCompareOffset.getState().frames).toBe(2);
    press({ code: 'BracketLeft', key: '[' });
    expect(useCompareOffset.getState().frames).toBe(1);
  });

  it('converts to seconds at the frame rate of the media', () => {
    mount(fakeVideo(), vi.fn(), 25);
    press({ code: 'BracketRight', key: ']' });
    expect(useCompareOffset.getState().seconds).toBeCloseTo(0.04, 6);
  });

  it('advances by ten frames with Shift, and resets to zero with Shift+\\', () => {
    mount(fakeVideo());
    press({ code: 'BracketRight', key: '}', shiftKey: true });
    expect(useCompareOffset.getState().frames).toBe(10);
    press({ code: 'Backslash', key: '|', shiftKey: true });
    expect(useCompareOffset.getState().frames).toBe(0);
  });

  it('responds to the key position, even when the keyboard produces something else', () => {
    // AZERTY keyboard: the "BracketRight" position carries the "$" character.
    mount(fakeVideo());
    press({ code: 'BracketRight', key: '$' });
    expect(useCompareOffset.getState().frames).toBe(1);
  });

  it('forgets the offset when leaving the media: the next conform starts aligned', () => {
    const view = mount(fakeVideo());
    press({ code: 'BracketRight', key: ']' });
    expect(useCompareOffset.getState().frames).toBe(1);
    view.unmount();
    expect(useCompareOffset.getState().frames).toBe(0);
  });

  it('stays inert in an input field', () => {
    mount(fakeVideo());
    const input = document.createElement('input');
    document.body.appendChild(input);
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, cancelable: true, code: 'BracketRight' }),
      );
    });
    expect(useCompareOffset.getState().frames).toBe(0);
    input.remove();
  });
});
