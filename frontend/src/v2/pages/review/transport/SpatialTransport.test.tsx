// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SpatialTransport from './SpatialTransport';
import type { CameraAnimState } from '../camera/useCameraAnim';

/** Minimal animation state: the transport only reads these fields. */
const animState = (over: Partial<CameraAnimState> = {}) =>
  ({
    keyTimes: [0, 1000, 2000],
    playDuration: 2000,
    duration: 2000,
    timeMs: 0,
    playing: false,
    loop: true,
    autoKey: false,
    hasAnimation: true,
    canUndo: false,
    canRedo: false,
    scrub: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    setLoop: vi.fn(),
    setDuration: vi.fn(),
    setAutoKey: vi.fn(),
    insertKeyAtView: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    ...over,
  }) as unknown as CameraAnimState;

/** Anchors the track at 200 px: happy-dom measures nothing and does not capture the pointer. */
const anchor = (el: Element) => {
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 24 }) as DOMRect;
  el.setPointerCapture = () => {};
  el.releasePointerCapture = () => {};
};

const mount = (anim: CameraAnimState, fps = 10) =>
  render(<SpatialTransport anim={anim} editable fps={fps} drawerOpen={false} onDrawer={vi.fn()} />).container;

describe('SpatialTransport — playhead clamped to its track', () => {
  it('at mid-duration, the playhead is at half the track', () => {
    const container = mount(animState({ timeMs: 1000 }));
    expect((container.querySelector('.rv-track__head') as HTMLElement).style.left).toBe('50%');
    expect((container.querySelector('.rv-track__fill') as HTMLElement).style.width).toBe('50%');
  });

  it('far along the timeline, the playhead stops at the edge instead of overflowing', () => {
    // A scrub at 60 s on a 2 s animation set `left: 3000%`: the track overflowed the transport,
    // which scrolls in overflow-x, and a horizontal scrollbar appeared.
    const container = mount(animState({ timeMs: 60_000 }));
    expect((container.querySelector('.rv-track__head') as HTMLElement).style.left).toBe('100%');
    expect((container.querySelector('.rv-track__fill') as HTMLElement).style.width).toBe('100%');
  });

  it('keys beyond the duration stretch the track instead of spilling out of it', () => {
    // The track extends to the greater of the two: the playback duration set, or the last key.
    const container = mount(animState({ keyTimes: [0, 1000, 9000], playDuration: 2000 }));
    const lefts = [...container.querySelectorAll('.rv-key')].map((k) =>
      Number.parseFloat((k as HTMLElement).style.left),
    );
    expect(lefts[0]).toBe(0);
    expect(lefts[2]).toBe(100);
    for (const left of lefts) expect(left).toBeLessThanOrEqual(100);
  });
});

describe('SpatialTransport — scrub on the track', () => {
  it('a press on the track moves playback, snapped to the frame', () => {
    const anim = animState();
    const container = mount(anim);
    const track = container.querySelector('.rv-track') as HTMLElement;
    anchor(track);
    fireEvent.pointerDown(track, { button: 0, clientX: 50, pointerId: 1 });
    expect(anim.scrub).toHaveBeenCalledWith(500);
  });

  it('dragging follows the pointer, and stops on release', () => {
    const anim = animState();
    const container = mount(anim);
    const track = container.querySelector('.rv-track') as HTMLElement;
    anchor(track);
    fireEvent.pointerDown(track, { button: 0, clientX: 50, pointerId: 1 });
    fireEvent.pointerMove(track, { clientX: 150, pointerId: 1 });
    expect(anim.scrub).toHaveBeenLastCalledWith(1500);
    fireEvent.pointerUp(track, { clientX: 150, pointerId: 1 });
    fireEvent.pointerMove(track, { clientX: 20, pointerId: 1 });
    expect(anim.scrub).toHaveBeenCalledTimes(2);
  });

  it('clicking a diamond goes exactly to the key, without going through the track', () => {
    const anim = animState();
    const container = mount(anim);
    const track = container.querySelector('.rv-track') as HTMLElement;
    anchor(track);
    fireEvent.click(container.querySelectorAll('.rv-key')[1]);
    expect(anim.scrub).toHaveBeenCalledWith(1000);
  });
});
