// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';

/**
 * On-demand rendering for the WebGL viewers (3D model and splat) — F14.
 *
 * Both viewers used to arm `renderer.setAnimationLoop` on mount and render at the screen's
 * refresh rate until unmount, even on a strictly static scene: sixty identical frames per
 * second, a laptop fan spinning while reading comments.
 *
 * The trap of this fix is a **frozen** image: if a change source is forgotten, the viewer never
 * refreshes again, which is far worse than the fan. Three safeguards, in this order, each
 * covering the gaps of the previous one:
 *
 * 1. **`update` always runs.** OrbitControls damping, `AnimationMixer` and frame subscribers
 *    run on every tick; only GPU passes and layout measurements are skipped. Nothing driving the
 *    scene therefore changes cadence, and the render decision is taken **after** those updates:
 *    a camera move made by a subscriber (turntable, camera animation) is seen in the very frame
 *    where it happens.
 * 2. **Broad invalidation sources.** OrbitControls `change` (orbit, zoom, pan, dolly, view
 *    restore, end of damping), resize, and **any user input on the window** — a HUD setting that
 *    touches the scene (HDRI, cutting plane, USD variant, display mode, splat mask, gizmo) is
 *    always preceded by a click, a key press or a pointer movement. The `INPUT_WINDOW_MS` window
 *    opened after each input covers the delay between the gesture and the React effect that
 *    changes the scene.
 * 3. **Safety heartbeat.** Even without any invalidation, a frame is rendered every
 *    `IDLE_FRAME_INTERVAL_MS`. A forgotten source — typically an asynchronous arrival: HDRI
 *    loaded, variant baked, comparison model, persisted splat edits — therefore costs at worst
 *    this delay, never a freeze. This is what makes the fix safe by construction.
 */

/** Safety heartbeat at rest: one frame every 125 ms (8/s instead of ~60/s). */
export const IDLE_FRAME_INTERVAL_MS = 125;
/** Full-rate render window opened after a user input. */
export const INPUT_WINDOW_MS = 300;
/** Window opened by a thumbnail request (the capture follows a render immediately). */
export const CAPTURE_WINDOW_MS = 500;
/** Window given to a freshly loaded scene to settle (decoding, LOD, sorting). */
export const SETTLE_WINDOW_MS = 2000;

export interface RenderScheduler {
  /** Requests a render of the next frame, and of all frames within the next `windowMs`. */
  invalidate: (windowMs?: number) => void;
  /** True if this frame must be rendered — records the render time when it is. */
  shouldRender: (nowMs: number) => boolean;
}

/** `change` emitter (OrbitControls) — minimally typed to stay testable without WebGL. */
export interface ChangeEmitter {
  addEventListener: (type: 'change', listener: () => void) => void;
  removeEventListener: (type: 'change', listener: () => void) => void;
}

/** Render loop host — `WebGLRenderer` in production, a simple object in tests. */
export interface AnimationLoopHost {
  setAnimationLoop: (cb: (() => void) | null) => void;
}

export interface RenderSchedulerOptions {
  /**
   * True while continuous motion forces full rate: flight, animation clip playing, frame
   * subscriber (turntable, camera animation, A/B fade, camera rig), pending capture.
   */
  isBusy: () => boolean;
  idleIntervalMs?: number;
  /** Injectable clock — tests measure a number of frames, not real time. */
  now?: () => number;
}

export function createRenderScheduler(opts: RenderSchedulerOptions): RenderScheduler {
  const { isBusy } = opts;
  const idleIntervalMs = opts.idleIntervalMs ?? IDLE_FRAME_INTERVAL_MS;
  const clock = opts.now ?? (() => performance.now());
  let dirty = true; // the first frame is always rendered
  let dirtyUntilMs = 0;
  let lastRenderMs: number | null = null;

  return {
    invalidate(windowMs = 0) {
      dirty = true;
      if (windowMs > 0) dirtyUntilMs = Math.max(dirtyUntilMs, clock() + windowMs);
    },
    shouldRender(nowMs) {
      const render =
        isBusy() ||
        dirty ||
        nowMs < dirtyUntilMs ||
        lastRenderMs === null ||
        nowMs - lastRenderMs >= idleIntervalMs;
      if (render) {
        dirty = false;
        lastRenderMs = nowMs;
      }
      return render;
    },
  };
}

/**
 * User inputs listened to at window level: a HUD setting that changes the scene necessarily goes
 * through one of them. Listens **passively and in capture** — no page behaviour is altered, and
 * no `preventDefault` is possible from these listeners.
 */
const INPUT_EVENTS = [
  'pointerdown',
  'pointerup',
  'pointermove',
  'wheel',
  'keydown',
  'keyup',
  'input',
  'change',
  'touchstart',
  'touchmove',
] as const;

/** Scheduler wired to its ambient invalidation sources. `detach` removes the listeners. */
export function armRenderScheduler(
  controls: ChangeEmitter,
  opts: RenderSchedulerOptions,
): RenderScheduler & { detach: () => void } {
  const scheduler = createRenderScheduler(opts);
  const onChange = () => scheduler.invalidate();
  const onInput = () => scheduler.invalidate(INPUT_WINDOW_MS);
  const listenerOpts = { capture: true, passive: true } as const;
  controls.addEventListener('change', onChange);
  for (const type of INPUT_EVENTS) window.addEventListener(type, onInput, listenerOpts);
  // Tab coming back: the browser suspended the loop, the displayed image may be stale.
  document.addEventListener('visibilitychange', onInput);
  return {
    ...scheduler,
    detach() {
      controls.removeEventListener('change', onChange);
      for (const type of INPUT_EVENTS) window.removeEventListener(type, onInput, listenerOpts);
      document.removeEventListener('visibilitychange', onInput);
    },
  };
}

export interface RenderLoopOptions {
  renderer: AnimationLoopHost;
  scheduler: RenderScheduler;
  /** Scene updates — run on **every** tick, rendered or not (see safeguard 1). */
  update: (dt: number) => void;
  /** GPU passes, layout measurements, sampling — only when a render is due. */
  draw: (nowMs: number) => void;
  now?: () => number;
}

/** Arms the on-demand render loop. Returns the stop function (unmount). */
export function startRenderLoop(opts: RenderLoopOptions): () => void {
  const { renderer, scheduler, update, draw } = opts;
  const clock = opts.now ?? (() => performance.now());
  let last = clock();
  renderer.setAnimationLoop(() => {
    const now = clock();
    const dt = (now - last) / 1000;
    last = now;
    update(dt);
    if (scheduler.shouldRender(now)) draw(now);
  });
  return () => renderer.setAnimationLoop(null);
}

export interface ViewerLoopOptions extends RenderSchedulerOptions {
  renderer: AnimationLoopHost;
  controls: ChangeEmitter;
  update: (dt: number) => void;
  draw: (nowMs: number) => void;
}

/**
 * Render gate of a WebGL viewer: everything the viewer hook must hold to switch to on-demand
 * rendering — invalidation, passive subscriptions, FPS reader counting, loop.
 */
export interface RenderGate {
  /** Requests a render — no effect (and no error) until the loop is armed. */
  invalidate: (windowMs?: number) => void;
  /**
   * **Passive** subscription to the loop: run on every tick like the others, but without forcing
   * full rate. `useModelAnimations` subscribes permanently to re-read `action.time`; without this
   * distinction the set of subscribers would never be empty on the 3D side and on-demand
   * rendering would never kick in. A clip being played is still detected by `isRunning()`.
   */
  subscribeIdle: (cb: (dt: number) => void) => () => void;
  /**
   * Counts the subscribers of a performance sampler: while a panel reads the FPS, the viewer
   * renders continuously — a frames-per-second counter that lowers the rate it measures measures
   * nothing, and the figure read by the artist would be comparable to nothing.
   */
  countSub: (off: (() => void) | undefined) => (() => void) | undefined;
  /** Arms scheduler + loop. Returns the stop function (loop, listeners, invalidation). */
  start: (opts: ViewerLoopOptions) => () => void;
}

export function createRenderGate(): RenderGate {
  const idleCbs = new Set<(dt: number) => void>();
  let statsSubs = 0;
  let invalidateFn: ((windowMs?: number) => void) | null = null;
  const invalidate = (windowMs?: number) => invalidateFn?.(windowMs);

  return {
    invalidate,
    subscribeIdle(cb) {
      idleCbs.add(cb);
      return () => idleCbs.delete(cb);
    },
    countSub(off) {
      if (!off) return undefined;
      statsSubs += 1;
      invalidate();
      return () => {
        statsSubs -= 1;
        off();
      };
    },
    start(opts) {
      const scheduler = armRenderScheduler(opts.controls, {
        isBusy: () => statsSubs > 0 || opts.isBusy(),
        idleIntervalMs: opts.idleIntervalMs,
        now: opts.now,
      });
      invalidateFn = scheduler.invalidate;
      const stop = startRenderLoop({
        renderer: opts.renderer,
        scheduler,
        // Passive subscribers re-read the state **after** the viewer updates (animation time only
        // makes sense once `mixer.update` has run).
        update: (dt) => {
          opts.update(dt);
          for (const cb of idleCbs) cb(dt);
        },
        draw: opts.draw,
        now: opts.now,
      });
      return () => {
        invalidateFn = null;
        stop();
        scheduler.detach();
      };
    },
  };
}

/** Stable gate for the component's lifetime (recreating it would lose the armed loop). */
export function useRenderGate(): RenderGate {
  const [gate] = useState(createRenderGate);
  return gate;
}
