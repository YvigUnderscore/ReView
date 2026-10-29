// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, renderHook, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useHlsPlayer } from './useHlsPlayer';

/**
 * Two properties are checked here, and the first is a **count**: the number of times the `hls.js`
 * module is evaluated. With the former static import, it was 1 as soon as the hook was imported —
 * hence for an image, 3D or splat review. It must be 0 as long as no playlist is played, then 1
 * whatever follows.
 *
 * The second is the screen contract: `active` (hence "does the video element receive `src`?") must be
 * known **from the first render**, without waiting for the download — otherwise the player would show
 * an MP4 for a round trip before switching.
 */

const lib = vi.hoisted(() => ({
  /** Number of evaluations of the `hls.js` module = number of player downloads. */
  loads: 0,
  /** Number of player instances created. */
  created: 0,
  last: null as FakePlayer | null,
}));

interface FakePlayer {
  config: { xhrSetup?: (xhr: XMLHttpRequest, url: string) => void };
  media: HTMLVideoElement | null;
  src: string | null;
  levels: { height: number; bitrate: number }[];
  currentLevel: number;
  nextLevel: number;
  destroyed: boolean;
  on(evt: string, cb: (evt: string, data?: unknown) => void): void;
  emit(evt: string, data?: unknown): void;
  destroy(): void;
}

vi.mock('hls.js', () => {
  lib.loads += 1;
  class FakeHls {
    static Events = { MANIFEST_PARSED: 'manifestParsed', LEVEL_SWITCHED: 'levelSwitched', ERROR: 'error' };
    media: HTMLVideoElement | null = null;
    src: string | null = null;
    levels = [
      { height: 540, bitrate: 1_000 },
      { height: 1080, bitrate: 4_000 },
      { height: 720, bitrate: 2_000 },
    ];
    currentLevel = -1;
    nextLevel = -1;
    destroyed = false;
    private handlers = new Map<string, ((evt: string, data?: unknown) => void)[]>();
    constructor(public config: { xhrSetup?: (xhr: XMLHttpRequest, url: string) => void }) {
      lib.created += 1;
      lib.last = this;
    }
    attachMedia(v: HTMLVideoElement) {
      this.media = v;
    }
    loadSource(u: string) {
      this.src = u;
    }
    on(evt: string, cb: (evt: string, data?: unknown) => void) {
      this.handlers.set(evt, [...(this.handlers.get(evt) ?? []), cb]);
    }
    emit(evt: string, data?: unknown) {
      (this.handlers.get(evt) ?? []).forEach((cb) => cb(evt, data));
    }
    destroy() {
      this.destroyed = true;
    }
  }
  return { default: FakeHls };
});

// MSE present: without this stub, happy-dom would make everyone fall back to the MP4 path.
(globalThis as Record<string, unknown>).MediaSource = { isTypeSupported: () => true };

const MASTER = '/api/media/7/hls/master.m3u8';

function mountPlayer(url: string | null) {
  const ref = createRef<HTMLVideoElement | null>() as { current: HTMLVideoElement | null };
  ref.current = document.createElement('video');
  return { ref, ...renderHook(() => useHlsPlayer(ref, url)) };
}

describe('useHlsPlayer — the adaptive player is only downloaded for a video', () => {
  it('a review without a playlist never evaluates hls.js', async () => {
    expect(lib.loads).toBe(0);
    const image = mountPlayer(null);
    expect(image.result.current.active).toBe(false);
    // Nor does an MP4 source (media transcoded before the adaptive scale, or a burned-in trim).
    const mp4 = mountPlayer('/api/media/7/proxy.mp4');
    expect(mp4.result.current.active).toBe(false);
    await act(async () => {
      await Promise.resolve();
    });
    expect(lib.loads).toBe(0);
    expect(lib.created).toBe(0);
  });

  it('a playlist loads it — only once for two players (A/B comparison)', async () => {
    const a = mountPlayer(MASTER);
    // No round trip is needed to know what to display: the video element knows from this very render
    // that it must not set `src`.
    expect(a.result.current.active).toBe(true);
    mountPlayer(MASTER);
    await waitFor(() => expect(lib.created).toBe(2));
    expect(lib.loads).toBe(1);
  });

  it('still plays: manifest attached, best rendition locked', async () => {
    const { ref, result } = mountPlayer(MASTER);
    await waitFor(() => expect(lib.last?.src).toBe(MASTER));
    const player = lib.last!;
    expect(player.media).toBe(ref.current);
    act(() => player.emit('manifestParsed'));
    // 1080 is the highest of the three renditions — it is the one that must be locked.
    expect(player.currentLevel).toBe(1);
    expect(result.current.level).toBe(1);
    expect(result.current.levels.map((l) => l.height)).toEqual([540, 1080, 720]);
  });

  it('an unmount during the download attaches no player to the removed DOM', async () => {
    const before = lib.created;
    const { unmount } = mountPlayer(MASTER);
    unmount();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(lib.created).toBe(before);
  });

  it('destroys the player on unmount (no instance left behind)', async () => {
    const { unmount } = mountPlayer(MASTER);
    await waitFor(() => expect(lib.created).toBeGreaterThan(0));
    const player = lib.last!;
    unmount();
    expect(player.destroyed).toBe(true);
  });
});
