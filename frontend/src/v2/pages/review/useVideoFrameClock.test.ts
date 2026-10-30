// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, cleanup, renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasFrameCallback, useVideoFrameClock } from './useVideoFrameClock';

/**
 * Fake player: `EventTarget` is enough — the hook only expects from the media its events, its
 * `currentTime` and, when it exists, its presented-frame announcement.
 */
class FakeVideo extends EventTarget {
  currentTime = 0;
  paused = true;
  /** Queue of pending `requestVideoFrameCallback` callbacks. */
  pending: ((now: number, meta: { mediaTime: number }) => void)[] = [];
  cancelled: number[] = [];

  requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;

  withFrameCallback(): this {
    this.requestVideoFrameCallback = (cb) => {
      this.pending.push(cb);
      return this.pending.length;
    };
    this.cancelVideoFrameCallback = (handle) => this.cancelled.push(handle);
    return this;
  }

  /** The decoder presents the frame whose timestamp is `mediaTime`. */
  present(mediaTime: number): void {
    const cbs = this.pending;
    this.pending = [];
    cbs.forEach((cb) => cb(performance.now(), { mediaTime }));
  }

  emit(type: string): void {
    this.dispatchEvent(new Event(type));
  }
}

const mount = (video: FakeVideo, fps = 24) => {
  const ref = createRef<HTMLVideoElement>();
  (ref as { current: unknown }).current = video;
  return renderHook(() => useVideoFrameClock(ref, fps));
};

afterEach(() => {
  // `globals` disabled in the vitest config: teardown is our responsibility.
  cleanup();
  vi.restoreAllMocks();
});

describe('useVideoFrameClock — frame by frame rather than four times per second', () => {
  it('follows each presented frame, without waiting for timeupdate', () => {
    const video = new FakeVideo().withFrameCallback();
    const { result } = mount(video);
    expect(result.current).toBe(0);

    // Three consecutive frames at 24 fps: the counter follows each of them although no `timeupdate`
    // was emitted — that is precisely what was missing.
    act(() => video.present(1 / 24));
    expect(result.current).toBe(1);
    act(() => video.present(2 / 24));
    expect(result.current).toBe(2);
    act(() => video.present(3 / 24));
    expect(result.current).toBe(3);
  });

  it('derives the number from the corrected rate, not from its rounding', () => {
    const video = new FakeVideo().withFrameCallback();
    // 23.976: frame 6000 of a four-minute shot at 24000/1001.
    const { result } = mount(video, 23.976);
    act(() => video.present((6000 * 1001) / 24000));
    expect(result.current).toBe(6000);
  });

  it('keeps timeupdate and seeked as a safety net: pause, scrub, frame stepping', () => {
    const video = new FakeVideo().withFrameCallback();
    const { result } = mount(video);
    video.currentTime = 10;
    act(() => video.emit('timeupdate'));
    expect(result.current).toBe(240);
    video.currentTime = 2;
    act(() => video.emit('seeked'));
    expect(result.current).toBe(48);
  });

  it('without requestVideoFrameCallback, runs on rAF during playback only', () => {
    const video = new FakeVideo();
    expect(hasFrameCallback(video as unknown as HTMLVideoElement)).toBe(false);
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    const { result } = mount(video);
    // When stopped, there is no loop: nothing wakes the tab.
    expect(frames).toHaveLength(0);

    video.paused = false;
    act(() => video.emit('play'));
    video.currentTime = 1;
    act(() => frames.pop()!(0));
    expect(result.current).toBe(24);
  });

  it('releases the frame callback on unmount', () => {
    const video = new FakeVideo().withFrameCallback();
    const { unmount } = mount(video);
    unmount();
    expect(video.cancelled).toHaveLength(1);
    // No listeners left: a frame presented afterwards does not restart the loop.
    act(() => video.present(1));
    expect(video.pending).toHaveLength(0);
  });
});
