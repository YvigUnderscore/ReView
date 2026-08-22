// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearPointers, getPointers, receivePointer, setPointerEmitter } from './pointerBus';
import { normalizeInBox, useLivePointerCapture } from './useLivePointerCapture';

const rect = { left: 100, top: 50, width: 200, height: 100 };

beforeEach(() => {
  clearPointers();
  setPointerEmitter(null);
});
afterEach(() => {
  clearPointers();
  setPointerEmitter(null);
});

describe('normalizeInBox', () => {
  it('rend une fraction du cadre', () => {
    expect(normalizeInBox(rect, 200, 100)).toEqual({ x: 0.5, y: 0.5 });
    expect(normalizeInBox(rect, 100, 50)).toEqual({ x: 0, y: 0 });
    expect(normalizeInBox(rect, 300, 150)).toEqual({ x: 1, y: 1 });
  });

  it('hors cadre : rien à montrer', () => {
    expect(normalizeInBox(rect, 99, 100)).toBeNull();
    expect(normalizeInBox(rect, 200, 151)).toBeNull();
  });

  it('cadre non mesuré : rien à montrer', () => {
    expect(normalizeInBox({ left: 0, top: 0, width: 0, height: 0 }, 0, 0)).toBeNull();
  });

  it('arrondit à la 4e décimale — inutile de transporter plus de précision', () => {
    expect(normalizeInBox(rect, 100 + 200 / 3, 100)?.x).toBe(0.3333);
  });
});

describe('useLivePointerCapture', () => {
  const boxRef = { current: { getBoundingClientRect: () => rect } as unknown as HTMLElement };

  it('hors session, aucun geste ne part', () => {
    const { result } = renderHook(() => useLivePointerCapture(boxRef));
    result.current.onPointerMove({ clientX: 200, clientY: 100 });
    result.current.onPointerLeave();
  });

  it('en diffusion, le geste part normalisé ; sortir du cadre efface le curseur', () => {
    const emit = vi.fn();
    setPointerEmitter(emit);
    const { result } = renderHook(() => useLivePointerCapture(boxRef));
    result.current.onPointerMove({ clientX: 150, clientY: 75 });
    expect(emit).toHaveBeenCalledWith({ x: 0.25, y: 0.25 });
    result.current.onPointerMove({ clientX: 1000, clientY: 75 });
    expect(emit).toHaveBeenLastCalledWith(null);
    result.current.onPointerLeave();
    expect(emit).toHaveBeenLastCalledWith(null);
  });

  it('le démontage (changement de média) efface les curseurs affichés', () => {
    const { unmount } = renderHook(() => useLivePointerCapture(boxRef));
    receivePointer({ userId: 4, x: 0.5, y: 0.5 }, 'Ada');
    expect(getPointers()).toHaveLength(1);
    unmount();
    expect(getPointers()).toHaveLength(0);
  });
});
