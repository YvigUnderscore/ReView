// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { createViewSync, viewsEqual } from './useImageCompareSync';

const view = (scale: number, cx = 0.5, cy = 0.5) => ({ scale, cx, cy });

describe('viewsEqual — view equality within epsilon (34.D)', () => {
  it('strict equality and epsilon tolerance', () => {
    expect(viewsEqual(view(2), view(2))).toBe(true);
    expect(viewsEqual(view(2), view(2 + 1e-5))).toBe(true);
    expect(viewsEqual(view(2), view(2.1))).toBe(false);
    expect(viewsEqual(view(2, 0.5), view(2, 0.6))).toBe(false);
    expect(viewsEqual(null, view(2))).toBe(false);
  });
});

describe('createViewSync — A↔B relay without a loop (34.D)', () => {
  it('propagates the master view to pane B', () => {
    const sync = createViewSync();
    const applyB = vi.fn();
    expect(sync.fromMaster(view(2), applyB)).toBe(true);
    expect(applyB).toHaveBeenCalledWith(view(2));
  });

  it('cuts the echo: the view re-emitted by B after application is ignored', () => {
    const sync = createViewSync();
    const applyB = vi.fn();
    const applyA = vi.fn();
    sync.fromSlave(view(1), applyA, applyB); // initial fit of B (consumed)
    sync.fromMaster(view(2), applyB); // A → B
    expect(sync.fromSlave(view(2 + 1e-5), applyA, applyB)).toBe(false);
    expect(applyA).not.toHaveBeenCalled();
  });

  it('the initial fit of B adopts the master view instead of overwriting it', () => {
    const sync = createViewSync();
    const applyA = vi.fn();
    const applyB = vi.fn();
    sync.fromMaster(view(3, 0.2, 0.8), null); // the master is already zoomed, B not mounted
    sync.fromSlave(view(1), applyA, applyB); // initial fit of B
    expect(applyA).not.toHaveBeenCalled();
    expect(applyB).toHaveBeenCalledWith(view(3, 0.2, 0.8));
  });

  it('stays bidirectional: a real manipulation of B goes back to A', () => {
    const sync = createViewSync();
    const applyA = vi.fn();
    sync.fromSlave(view(1), applyA, null); // initial fit (consumed)
    expect(sync.fromSlave(view(3), applyA, null)).toBe(true);
    expect(applyA).toHaveBeenCalledWith(view(3));
  });
});
