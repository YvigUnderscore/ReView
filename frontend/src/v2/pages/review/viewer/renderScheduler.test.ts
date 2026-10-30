// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  createRenderGate,
  createRenderScheduler,
  IDLE_FRAME_INTERVAL_MS,
  INPUT_WINDOW_MS,
  startRenderLoop,
  type ChangeEmitter,
} from './renderScheduler';

/**
 * On-demand rendering (F14). The quantity measured here is the **number of rendered frames**: the
 * loop is driven with an injected clock and calls to `draw` are counted. The contrast between
 * `isBusy: true` (behaviour before the fix — one frame per tick) and `isBusy: false` (static
 * scene) gives the before/after measure within the same suite.
 */

const FRAME_MS = 1000 / 60;

/** Minimal renderer: remembers the armed loop and lets it advance tick by tick. */
function makeRenderer() {
  let loop: (() => void) | null = null;
  return {
    setAnimationLoop(cb: (() => void) | null) {
      loop = cb;
    },
    get armed() {
      return loop !== null;
    },
    tick() {
      loop?.();
    },
  };
}

/** Minimal OrbitControls: only exposes the `change` event. */
function makeControls() {
  const listeners = new Set<() => void>();
  const emitter: ChangeEmitter & { emitChange: () => void; count: () => number } = {
    addEventListener: (_type, listener) => void listeners.add(listener),
    removeEventListener: (_type, listener) => void listeners.delete(listener),
    emitChange: () => listeners.forEach((l) => l()),
    count: () => listeners.size,
  };
  return emitter;
}

/** Measurement bench: 10 s of loop at 60 Hz, counters for updates and rendered frames. */
function bench(isBusy: () => boolean, onUpdate?: () => void) {
  const clock = { t: 0 };
  const renderer = makeRenderer();
  const controls = makeControls();
  const gate = createRenderGate();
  const counts = { updates: 0, draws: 0 };
  const stop = gate.start({
    renderer,
    controls,
    isBusy,
    now: () => clock.t,
    update: () => {
      counts.updates += 1;
      onUpdate?.();
    },
    draw: () => {
      counts.draws += 1;
    },
  });
  const run = (frames: number) => {
    for (let i = 0; i < frames; i += 1) {
      clock.t += FRAME_MS;
      renderer.tick();
    }
  };
  return { clock, renderer, controls, gate, counts, stop, run };
}

describe('renderScheduler — on-demand rendering of WebGL viewers (F14)', () => {
  it('static scene: ~8 frames rendered per second, while the loop still runs at 60', () => {
    const idle = bench(() => false);
    idle.run(600); // 10 s
    idle.stop();

    // Safeguard 1: nothing driving the scene changes cadence.
    expect(idle.counts.updates).toBe(600);
    // Safety heartbeat: one frame every 125 ms, plus the very first one — but the heartbeat can
    // only fall on a frame boundary. At 60 Hz, seven frames take 116.7 ms (too early) and eight
    // take 133.3: the real interval is therefore EIGHT frames, not 7.5.
    // Counting in milliseconds would overestimate the number of rendered frames by 8%.
    const imagesParBattement = Math.ceil(IDLE_FRAME_INTERVAL_MS / FRAME_MS);
    const attendu = 1 + Math.floor((600 - 1) / imagesParBattement);
    expect(idle.counts.draws).toBe(attendu);

    // "Before" measure: this is exactly what the original loop did, unconditionally.
    const avant = bench(() => true);
    avant.run(600);
    avant.stop();
    expect(avant.counts.draws).toBe(600);
    expect(idle.counts.draws * 7).toBeLessThan(avant.counts.draws);
  });

  it('a moving scene renders every frame (flight, clip, frame subscriber, capture)', () => {
    let bouge = true;
    const b = bench(() => bouge);
    b.run(60);
    expect(b.counts.draws).toBe(60);
    bouge = false; // the motion stops: back to the heartbeat
    b.run(60);
    b.stop();
    expect(b.counts.draws).toBeLessThan(60 + 12);
  });

  it('OrbitControls damping carries on by itself, then stops', () => {
    // OrbitControls only emits `change` while the camera actually moves: five damping steps
    // must yield five frames, and nothing continuous afterwards.
    let restant = 5;
    const b = bench(
      () => false,
      () => {
        if (restant > 0) {
          restant -= 1;
          b.controls.emitChange();
        }
      },
    );
    b.run(5);
    expect(b.counts.draws).toBe(5); // the `change` emitted in `update` is seen in the same frame
    const apresAmortissement = b.counts.draws;
    b.run(5); // 83 ms: below the heartbeat, nothing left to draw
    b.stop();
    expect(b.counts.draws).toBe(apresAmortissement);
  });

  it('a user input on the window opens a full-rate render window', () => {
    const b = bench(() => false);
    b.run(1); // consume the first frame
    const avant = b.counts.draws;
    window.dispatchEvent(new Event('pointerdown'));
    const frames = Math.floor(INPUT_WINDOW_MS / FRAME_MS) - 1;
    b.run(frames);
    b.stop();
    expect(b.counts.draws - avant).toBe(frames); // every frame of the window is rendered
  });

  it('stopping removes the listeners: no ambient invalidation anymore', () => {
    const b = bench(() => false);
    expect(b.controls.count()).toBe(1);
    b.run(1);
    b.stop();
    expect(b.controls.count()).toBe(0);
    expect(b.renderer.armed).toBe(false);
    // An input after unmount must no longer wake anything.
    const avant = b.counts.draws;
    window.dispatchEvent(new Event('pointerdown'));
    b.run(5);
    expect(b.counts.draws).toBe(avant);
  });

  it('a subscriber to the performance counters forces full rate, and releases it on leaving', () => {
    const b = bench(() => false);
    const off = b.gate.countSub(() => undefined);
    b.run(60);
    expect(b.counts.draws).toBe(60); // the displayed FPS stays the viewer's, not the idle one
    off?.();
    const avant = b.counts.draws;
    b.run(60);
    b.stop();
    expect(b.counts.draws - avant).toBeLessThan(12);
  });

  it('countSub passes through a missing subscription (sampler not mounted yet)', () => {
    const gate = createRenderGate();
    expect(gate.countSub(undefined)).toBeUndefined();
  });

  it('passive subscribers run on every tick without forcing a render', () => {
    const b = bench(() => false);
    let passifs = 0;
    const off = b.gate.subscribeIdle(() => {
      passifs += 1;
    });
    b.run(60);
    expect(passifs).toBe(60); // re-reading the animation time keeps its cadence
    expect(b.counts.draws).toBeLessThan(12); // but it forces no frame
    off();
    b.run(10);
    b.stop();
    expect(passifs).toBe(60);
  });

  it('invalidate() renders only one frame; invalidate(ms) renders the whole window', () => {
    const clock = { t: 0 };
    const scheduler = createRenderScheduler({ isBusy: () => false, now: () => clock.t });
    expect(scheduler.shouldRender(0)).toBe(true); // first frame
    expect(scheduler.shouldRender(16)).toBe(false);
    scheduler.invalidate();
    expect(scheduler.shouldRender(32)).toBe(true);
    expect(scheduler.shouldRender(48)).toBe(false);
    clock.t = 48;
    scheduler.invalidate(100);
    expect(scheduler.shouldRender(64)).toBe(true);
    expect(scheduler.shouldRender(80)).toBe(true);
    expect(scheduler.shouldRender(96)).toBe(true);
    // Last render at 96, window closed at 148: at 160 the window has passed AND the heartbeat
    // (96 + 125 = 221) is not reached — so nothing is rendered.
    expect(scheduler.shouldRender(160)).toBe(false);
    expect(scheduler.shouldRender(221)).toBe(true); // heartbeat reached
    expect(scheduler.shouldRender(230)).toBe(false); // restarted for 125 ms
  });

  it('startRenderLoop does stop the loop', () => {
    const renderer = makeRenderer();
    const scheduler = createRenderScheduler({ isBusy: () => true });
    let draws = 0;
    const stop = startRenderLoop({
      renderer,
      scheduler,
      update: () => undefined,
      draw: () => {
        draws += 1;
      },
    });
    renderer.tick();
    expect(draws).toBe(1);
    stop();
    expect(renderer.armed).toBe(false);
  });
});
