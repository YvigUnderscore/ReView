// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canSendPointer,
  clearPointers,
  getPointers,
  POINTER_INTERVAL_MS,
  POINTER_TTL_MS,
  readPointerFrame,
  receivePointer,
  sendPointer,
  setPointerEmitter,
} from './pointerBus';

// The bus is module state: each test starts from an empty room.
beforeEach(() => {
  vi.useFakeTimers();
  clearPointers();
  setPointerEmitter(null);
});
afterEach(() => {
  clearPointers();
  setPointerEmitter(null);
  vi.useRealTimers();
});

const positions = () => getPointers().map((p) => ({ userId: p.userId, x: p.x, label: p.label }));

describe('readPointerFrame', () => {
  it('accepts a complete frame', () => {
    expect(readPointerFrame({ pointer: { userId: 7, x: 0.5, y: 0.25 } })).toEqual({
      userId: 7,
      x: 0.5,
      y: 0.25,
    });
  });

  it('accepts a departure', () => {
    expect(readPointerFrame({ pointer: { userId: 7, gone: true } })).toEqual({
      userId: 7,
      x: 0,
      y: 0,
      gone: true,
    });
  });

  it('rejects everything else: the relay guarantees nothing', () => {
    expect(readPointerFrame(null)).toBeNull();
    expect(readPointerFrame({})).toBeNull();
    expect(readPointerFrame({ pointer: {} })).toBeNull();
    expect(readPointerFrame({ pointer: { userId: 'x', x: 0, y: 0 } })).toBeNull();
    expect(readPointerFrame({ pointer: { userId: 1, x: Number.NaN, y: 0 } })).toBeNull();
    expect(readPointerFrame({ mediaId: 3, t: 12 })).toBeNull();
  });
});

describe('sendPointer', () => {
  it('without an emitter, nothing is sent', () => {
    expect(canSendPointer()).toBe(false);
    sendPointer({ x: 0.5, y: 0.5 });
    vi.advanceTimersByTime(1000);
  });

  it('limits the rate and always transmits the last position', () => {
    const emit = vi.fn();
    setPointerEmitter(emit);
    sendPointer({ x: 0.1, y: 0 });
    sendPointer({ x: 0.2, y: 0 });
    sendPointer({ x: 0.3, y: 0 });
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenLastCalledWith({ x: 0.1, y: 0 });
    vi.advanceTimersByTime(POINTER_INTERVAL_MS);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenLastCalledWith({ x: 0.3, y: 0 });
  });

  it('leaving the frame is sent without waiting and cancels the pending position', () => {
    const emit = vi.fn();
    setPointerEmitter(emit);
    sendPointer({ x: 0.1, y: 0 });
    sendPointer({ x: 0.2, y: 0 });
    sendPointer(null);
    expect(emit).toHaveBeenLastCalledWith(null);
    vi.advanceTimersByTime(500);
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it('unplugging the emitter cancels what was left to send', () => {
    const emit = vi.fn();
    setPointerEmitter(emit);
    sendPointer({ x: 0.1, y: 0 });
    sendPointer({ x: 0.2, y: 0 });
    setPointerEmitter(null);
    vi.advanceTimersByTime(500);
    expect(emit).toHaveBeenCalledTimes(1);
  });
});

describe('receivePointer', () => {
  it('one cursor per participant, replaced at each frame', () => {
    receivePointer({ userId: 1, x: 0.1, y: 0.1 }, 'Ada');
    receivePointer({ userId: 2, x: 0.9, y: 0.9 }, 'Linus');
    receivePointer({ userId: 1, x: 0.5, y: 0.5 }, 'Ada');
    expect(positions()).toEqual([
      { userId: 2, x: 0.9, label: 'Linus' },
      { userId: 1, x: 0.5, label: 'Ada' },
    ]);
  });

  it('a departure removes the cursor, without touching the others', () => {
    receivePointer({ userId: 1, x: 0.1, y: 0.1 }, 'Ada');
    receivePointer({ userId: 2, x: 0.9, y: 0.9 }, 'Linus');
    receivePointer({ userId: 1, x: 0, y: 0, gone: true }, 'Ada');
    expect(positions()).toEqual([{ userId: 2, x: 0.9, label: 'Linus' }]);
  });

  it('a motionless cursor expires', () => {
    receivePointer({ userId: 1, x: 0.2, y: 0.2 }, 'Ada');
    expect(getPointers()).toHaveLength(1);
    vi.advanceTimersByTime(POINTER_TTL_MS + 500);
    expect(getPointers()).toHaveLength(0);
  });

  it('a moving cursor does not disappear', () => {
    receivePointer({ userId: 1, x: 0.2, y: 0.2 }, 'Ada');
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(POINTER_TTL_MS / 2);
      receivePointer({ userId: 1, x: 0.2 + i / 100, y: 0.2 }, 'Ada');
    }
    expect(getPointers()).toHaveLength(1);
  });

  it('subscribers are notified, and the snapshot stays stable without news', () => {
    const before = getPointers();
    receivePointer({ userId: 1, x: 0.2, y: 0.2 }, 'Ada');
    expect(getPointers()).not.toBe(before);
    expect(getPointers()).toBe(getPointers());
  });
});
