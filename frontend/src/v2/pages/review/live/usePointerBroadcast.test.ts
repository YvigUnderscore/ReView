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
  it('le driver diffuse son curseur sur le canal de la session', () => {
    renderHook(() => usePointerBroadcast(opts));
    expect(canSendPointer()).toBe(true);
    sendPointer({ x: 0.25, y: 0.75 });
    expect(emit).toHaveBeenCalledWith('live:sync', 'media:12', {
      mediaId: 12,
      pointer: { userId: 4, x: 0.25, y: 0.75 },
    });
  });

  it('la sortie du cadre est diffusée comme un départ', () => {
    renderHook(() => usePointerBroadcast(opts));
    sendPointer(null);
    expect(emit).toHaveBeenLastCalledWith('live:sync', 'media:12', {
      mediaId: 12,
      pointer: { userId: 4, gone: true },
    });
  });

  it('prendre la main efface les curseurs reçus — c’est nous qui montrons', () => {
    receivePointer({ userId: 9, x: 0.5, y: 0.5 }, 'Ada');
    renderHook(() => usePointerBroadcast(opts));
    expect(getPointers()).toHaveLength(0);
  });

  it('spectateur ou co-pilote non driver : rien ne part', () => {
    renderHook(() => usePointerBroadcast({ ...opts, isDriver: false }));
    expect(canSendPointer()).toBe(false);
    sendPointer({ x: 0.5, y: 0.5 });
    expect(emit).not.toHaveBeenCalled();
  });

  it('quitter la session débranche la diffusion', () => {
    const { unmount } = renderHook(() => usePointerBroadcast(opts));
    unmount();
    expect(canSendPointer()).toBe(false);
  });
});
