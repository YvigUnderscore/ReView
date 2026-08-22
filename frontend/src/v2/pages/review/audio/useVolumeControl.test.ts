// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useVolumeControl } from './useVolumeControl';

const player = () => ({ current: document.createElement('video') });

describe('useVolumeControl', () => {
  it('applique le volume au lecteur', () => {
    const ref = player();
    const { result } = renderHook(() => useVolumeControl(ref));
    expect(ref.current.volume).toBe(1);
    act(() => result.current.setVolume(0.4));
    expect(result.current.volume).toBe(0.4);
    expect(ref.current.volume).toBeCloseTo(0.4, 5);
    expect(result.current.muted).toBe(false);
  });

  it('descendre à zéro coupe le son : c’est ce que le geste veut dire', () => {
    const ref = player();
    const { result } = renderHook(() => useVolumeControl(ref));
    act(() => result.current.setVolume(0));
    expect(result.current.muted).toBe(true);
    expect(ref.current.muted).toBe(true);
  });

  it('la coupure bascule sans perdre le niveau', () => {
    const ref = player();
    const { result } = renderHook(() => useVolumeControl(ref));
    act(() => result.current.setVolume(0.6));
    act(() => result.current.toggleMute());
    expect(result.current.muted).toBe(true);
    expect(result.current.volume).toBe(0.6);
    act(() => result.current.toggleMute());
    expect(ref.current.muted).toBe(false);
    expect(ref.current.volume).toBeCloseTo(0.6, 5);
  });
});
