// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const emit = vi.fn();
vi.mock('../../../../lib/socket', () => ({ getSocket: () => ({ emit }) }));

import { canSendPointer, clearPointers, getPointers, receivePointer, sendPointer } from './pointerBus';
import { usePointerBroadcast } from './usePointerBroadcast';

const opts = { active: true, isDriver: true, sessionKey: 'media:12', selfId: 4, mediaId: 12 };

beforeEach(() => {
  emit.mockClear();
  clearPointers();
});
afterEach(() => clearPointers());

describe('usePointerBroadcast', () => {
  it('the driver broadcasts its cursor on the session channel', () => {
    renderHook(() => usePointerBroadcast(opts));
    expect(canSendPointer()).toBe(true);
    sendPointer({ x: 0.25, y: 0.75 });
    expect(emit).toHaveBeenCalledWith('live:sync', 'media:12', {
      mediaId: 12,
      pointer: { userId: 4, x: 0.25, y: 0.75 },
    });
  });

  it('leaving the frame is broadcast as a departure', () => {
    renderHook(() => usePointerBroadcast(opts));
    sendPointer(null);
    expect(emit).toHaveBeenLastCalledWith('live:sync', 'media:12', {
      mediaId: 12,
      pointer: { userId: 4, gone: true },
    });
  });

  it('taking over clears the received cursors: we are the ones pointing', () => {
    receivePointer({ userId: 9, x: 0.5, y: 0.5 }, 'Ada');
    renderHook(() => usePointerBroadcast(opts));
    expect(getPointers()).toHaveLength(0);
  });

  it('a viewer or non-driver co-pilot: nothing is sent', () => {
    renderHook(() => usePointerBroadcast({ ...opts, isDriver: false }));
    expect(canSendPointer()).toBe(false);
    sendPointer({ x: 0.5, y: 0.5 });
    expect(emit).not.toHaveBeenCalled();
  });

  it('leaving the session unplugs the broadcast', () => {
    const { unmount } = renderHook(() => usePointerBroadcast(opts));
    unmount();
    expect(canSendPointer()).toBe(false);
  });
});
