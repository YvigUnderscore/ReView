// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, cleanup, renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasFrameCallback, useVideoFrameClock } from './useVideoFrameClock';

/**
 * Faux lecteur : `EventTarget` suffit — le hook n'attend du média que ses événements, son
 * `currentTime` et, quand il existe, son annonce d'image présentée.
 */
class FakeVideo extends EventTarget {
  currentTime = 0;
  paused = true;
  /** File des rappels `requestVideoFrameCallback` en attente. */
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

  /** Le décodeur présente l'image dont l'horodatage est `mediaTime`. */
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
  // `globals` désactivé dans la config vitest : le démontage est à notre charge.
  cleanup();
  vi.restoreAllMocks();
});

describe('useVideoFrameClock — image par image plutôt que quatre fois par seconde', () => {
  it('suit chaque image présentée, sans attendre timeupdate', () => {
    const video = new FakeVideo().withFrameCallback();
    const { result } = mount(video);
    expect(result.current).toBe(0);

    // Trois images consécutives à 24 fps : le compteur suit chacune d'elles alors qu'aucun
    // `timeupdate` n'a été émis — c'est précisément ce qui manquait.
    act(() => video.present(1 / 24));
    expect(result.current).toBe(1);
    act(() => video.present(2 / 24));
    expect(result.current).toBe(2);
    act(() => video.present(3 / 24));
    expect(result.current).toBe(3);
  });

  it('dérive le numéro de la cadence corrigée, pas de son arrondi', () => {
    const video = new FakeVideo().withFrameCallback();
    // 23.976 : la frame 6000 d'un plan de quatre minutes à 24000/1001.
    const { result } = mount(video, 23.976);
    act(() => video.present((6000 * 1001) / 24000));
    expect(result.current).toBe(6000);
  });

  it('garde timeupdate et seeked comme filet : pause, scrub, pas-à-pas', () => {
    const video = new FakeVideo().withFrameCallback();
    const { result } = mount(video);
    video.currentTime = 10;
    act(() => video.emit('timeupdate'));
    expect(result.current).toBe(240);
    video.currentTime = 2;
    act(() => video.emit('seeked'));
    expect(result.current).toBe(48);
  });

  it('sans requestVideoFrameCallback, tourne en rAF pendant la lecture seulement', () => {
    const video = new FakeVideo();
    expect(hasFrameCallback(video as unknown as HTMLVideoElement)).toBe(false);
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    const { result } = mount(video);
    // À l'arrêt, aucune boucle : rien ne réveille l'onglet.
    expect(frames).toHaveLength(0);

    video.paused = false;
    act(() => video.emit('play'));
    video.currentTime = 1;
    act(() => frames.pop()!(0));
    expect(result.current).toBe(24);
  });

  it('libère le rappel d’image au démontage', () => {
    const video = new FakeVideo().withFrameCallback();
    const { unmount } = mount(video);
    unmount();
    expect(video.cancelled).toHaveLength(1);
    // Plus aucun écouteur : une image présentée après coup ne relance pas la boucle.
    act(() => video.present(1));
    expect(video.pending).toHaveLength(0);
  });
});
