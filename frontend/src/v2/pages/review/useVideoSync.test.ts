// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, cleanup, renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clampOffsetFrames, MAX_COMPARE_OFFSET_FRAMES, useCompareOffset } from './compareOffset';
import { useVideoSync } from './useVideoSync';

/** Faux lecteur : le hook n'utilise que le temps, la pause, la vitesse et les événements. */
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
// `globals` désactivé dans la config vitest : le démontage est à notre charge.
afterEach(() => cleanup());

describe('clampOffsetFrames', () => {
  it('arrondit à la frame et borne le décalage', () => {
    expect(clampOffsetFrames(2.4)).toBe(2);
    expect(clampOffsetFrames(-1000)).toBe(-MAX_COMPARE_OFFSET_FRAMES);
    expect(clampOffsetFrames(1000)).toBe(MAX_COMPARE_OFFSET_FRAMES);
    expect(clampOffsetFrames(Number.NaN)).toBe(0);
  });
});

describe('useVideoSync — décalage réglable entre les versions comparées', () => {
  it('sans décalage, l’esclave recopie le temps du maître', () => {
    const master = new FakeVideo();
    const slave = new FakeVideo();
    master.currentTime = 12;
    mount(master, slave);
    expect(slave.currentTime).toBe(12);
  });

  it('applique le décalage posé en frames : v02 retimée de deux frames', () => {
    const master = new FakeVideo();
    const slave = new FakeVideo();
    master.currentTime = 10;
    act(() => useCompareOffset.getState().set(2, 24));
    mount(master, slave);
    expect(slave.currentTime).toBeCloseTo(10 + 2 / 24, 6);
  });

  it('suit le maître au seek, décalage compris', () => {
    const master = new FakeVideo();
    const slave = new FakeVideo();
    act(() => useCompareOffset.getState().set(-12, 24));
    mount(master, slave);
    master.currentTime = 5;
    act(() => master.emit('seeking'));
    expect(slave.currentTime).toBeCloseTo(4.5, 6);
  });

  it('ne sort jamais des bornes du média esclave', () => {
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

  it('corrige la dérive vers la position décalée, pas vers celle du maître', () => {
    const master = new FakeVideo();
    const slave = new FakeVideo();
    act(() => useCompareOffset.getState().set(24, 24)); // +1 s
    master.currentTime = 20;
    mount(master, slave);
    master.paused = false;
    // L'esclave a décroché d'une demi-seconde : le recalage vise 21 s, pas 20 s.
    slave.currentTime = 21.5;
    act(() => master.emit('timeupdate'));
    expect(slave.currentTime).toBe(21);
  });

  it('un changement de décalage recale immédiatement l’esclave', () => {
    const master = new FakeVideo();
    const slave = new FakeVideo();
    master.currentTime = 8;
    mount(master, slave);
    expect(slave.currentTime).toBe(8);
    act(() => useCompareOffset.getState().nudge(24, 24));
    expect(slave.currentTime).toBe(9);
  });
});
