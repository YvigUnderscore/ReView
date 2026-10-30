// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, cleanup, renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clampOffsetFrames, MAX_COMPARE_OFFSET_FRAMES, useCompareOffset } from './compareOffset';
import { useVideoSync } from './useVideoSync';

/** Fake player: the hook only uses time, pause, speed and events. */
class FakeVideo extends EventTarget {
  currentTime = 0;
  duration = 60;
  paused = true;
  playbackRate = 1;
  play = vi.fn(async () => undefined);
  pause = vi.fn(() => {
    this.paused = true;
  });
  emit(type: string): void {
    this.dispatchEvent(new Event(type));
  }
}

const refTo = (v: FakeVideo) => {
  const ref = createRef<HTMLVideoElement>();
  (ref as { current: unknown }).current = v;
  return ref;
};

const mount = (master: FakeVideo, slave: FakeVideo) =>
  renderHook(() => useVideoSync(refTo(master), refTo(slave), true));

beforeEach(() => useCompareOffset.getState().reset());
// `globals` disabled in the vitest config: teardown is our responsibility.
afterEach(() => cleanup());

describe('clampOffsetFrames', () => {
  it('rounds to the frame and bounds the offset', () => {
    expect(clampOffsetFrames(2.4)).toBe(2);
    expect(clampOffsetFrames(-1000)).toBe(-MAX_COMPARE_OFFSET_FRAMES);
    expect(clampOffsetFrames(1000)).toBe(MAX_COMPARE_OFFSET_FRAMES);
    expect(clampOffsetFrames(Number.NaN)).toBe(0);
  });
});

describe('useVideoSync — adjustable offset between the compared versions', () => {
  it('without offset, the slave copies the master time', () => {
    const master = new FakeVideo();
    const slave = new FakeVideo();
    master.currentTime = 12;
    mount(master, slave);
    expect(slave.currentTime).toBe(12);
  });

  it('applies the offset set in frames: v02 retimed by two frames', () => {
    const master = new FakeVideo();
    const slave = new FakeVideo();
    master.currentTime = 10;
    act(() => useCompareOffset.getState().set(2, 24));
    mount(master, slave);
    expect(slave.currentTime).toBeCloseTo(10 + 2 / 24, 6);
  });

  it('follows the master on seek, offset included', () => {
    const master = new FakeVideo();
    const slave = new FakeVideo();
    act(() => useCompareOffset.getState().set(-12, 24));
    mount(master, slave);
    master.currentTime = 5;
    act(() => master.emit('seeking'));
    expect(slave.currentTime).toBeCloseTo(4.5, 6);
  });

  it('never goes beyond the bounds of the slave media', () => {
    const master = new FakeVideo();
    const slave = new FakeVideo();
    slave.duration = 4;
    master.currentTime = 3.9;
    act(() => useCompareOffset.getState().set(48, 24)); // +2 s
    mount(master, slave);
    expect(slave.currentTime).toBe(4);

    master.currentTime = 0;
    act(() => useCompareOffset.getState().set(-48, 24));
    act(() => master.emit('seeking'));
    expect(slave.currentTime).toBe(0);
  });

  it('corrects drift toward the offset position, not toward the master position', () => {
    const master = new FakeVideo();
    const slave = new FakeVideo();
    act(() => useCompareOffset.getState().set(24, 24)); // +1 s
    master.currentTime = 20;
    mount(master, slave);
    master.paused = false;
    // The slave has drifted by half a second: the resync targets 21 s, not 20 s.
    slave.currentTime = 21.5;
    act(() => master.emit('timeupdate'));
    expect(slave.currentTime).toBe(21);
  });

  it('a change of offset resyncs the slave immediately', () => {
    const master = new FakeVideo();
    const slave = new FakeVideo();
    master.currentTime = 8;
    mount(master, slave);
    expect(slave.currentTime).toBe(8);
    act(() => useCompareOffset.getState().nudge(24, 24));
    expect(slave.currentTime).toBe(9);
  });
});
