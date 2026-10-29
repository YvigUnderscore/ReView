// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
  CAPTURE_MAX_WIDTH,
  CAPTURE_MIN_WIDTH,
  EXCLUDE_FROM_CAPTURE,
  captureSize,
  hideCaptureMarkers,
  renderViewCapture,
  type CaptureObject,
  type CaptureSize,
} from './viewCapture';

/** Minimal scene: `traverse` is all the capture needs from a Three scene. */
const sceneOf = (objects: CaptureObject[]) => ({
  traverse: (visit: (o: CaptureObject) => void) => objects.forEach(visit),
});

const marker = (visible = true): CaptureObject => ({
  visible,
  userData: { [EXCLUDE_FROM_CAPTURE]: true },
});

describe('captureSize — the capture comes out at the delivery resolution, not the window one', () => {
  it('supersamples when the on-screen frame is smaller than the target width', () => {
    expect(captureSize(999, 16 / 9)).toEqual({ width: CAPTURE_MIN_WIDTH, height: 1080 });
  });

  it('keeps the native resolution when the render is already wider', () => {
    expect(captureSize(2844, 16 / 9)).toEqual({ width: 2844, height: 1600 });
  });

  it('respects the GPU ceiling, and the safety ceiling beyond it', () => {
    expect(captureSize(999, 16 / 9, 1024)).toEqual({ width: 1024, height: 576 });
    expect(captureSize(9000, 16 / 9, 99999).width).toBe(CAPTURE_MAX_WIDTH);
  });

  it('very tall format: it is the height that hits the ceiling', () => {
    const size = captureSize(400, 0.25);
    expect(size.height).toBe(CAPTURE_MAX_WIDTH);
    expect(size.width).toBe(1024);
  });

  it('aberrant aspect: falls back to 16:9 rather than a zero-height image', () => {
    expect(captureSize(1920, 0)).toEqual({ width: CAPTURE_MIN_WIDTH, height: 1080 });
    expect(captureSize(1920, Number.NaN)).toEqual({ width: CAPTURE_MIN_WIDTH, height: 1080 });
  });
});

describe('hideCaptureMarkers — screen markers leave the capture, then come back', () => {
  it('hides only the marked objects and restores them as they were', () => {
    const grid = marker();
    const model: CaptureObject = { visible: true };
    const show = hideCaptureMarkers(sceneOf([grid, model]));
    expect(grid.visible).toBe(false);
    expect(model.visible).toBe(true);
    show();
    expect(grid.visible).toBe(true);
  });

  it('leaves a marker that is already off invisible (the user had turned the grid off)', () => {
    const grid = marker(false);
    const show = hideCaptureMarkers(sceneOf([grid]));
    show();
    expect(grid.visible).toBe(false);
  });
});

/** Capture dependencies: a render that records the received size, an encoding, a restoration. */
function deps(opts: { renderAt?: (s: CaptureSize) => void; encode?: () => string | null } = {}) {
  const grid = marker();
  const sizes: CaptureSize[] = [];
  const restore = vi.fn();
  return {
    grid,
    sizes,
    restore,
    call: () =>
      renderViewCapture({
        buffer: { width: 1000, height: 562 },
        scene: sceneOf([grid]),
        aspect: 16 / 9,
        renderAt: (s) => {
          sizes.push(s);
          opts.renderAt?.(s);
        },
        encode: opts.encode ?? (() => 'data:image/png;base64,zzz'),
        restore,
      }),
  };
}

describe('renderViewCapture', () => {
  it('renders at the wanted resolution and returns the encoded image', () => {
    const d = deps();
    expect(d.call()).toBe('data:image/png;base64,zzz');
    expect(d.sizes).toEqual([{ width: CAPTURE_MIN_WIDTH, height: 1080 }]);
    expect(d.grid.visible).toBe(true);
    expect(d.restore).toHaveBeenCalledTimes(1);
  });

  it('a failing render leaves neither the scene without its grid nor the viewer mis-sized', () => {
    const d = deps({
      renderAt: () => {
        throw new Error('drawing buffer');
      },
    });
    expect(d.call()).toBeNull();
    expect(d.grid.visible).toBe(true);
    expect(d.restore).toHaveBeenCalledTimes(1);
  });

  it('a failing encoding (tainted canvas) ends the same way', () => {
    const d = deps({
      encode: () => {
        throw new Error('tainted');
      },
    });
    expect(d.call()).toBeNull();
    expect(d.grid.visible).toBe(true);
    expect(d.restore).toHaveBeenCalledTimes(1);
  });
});
