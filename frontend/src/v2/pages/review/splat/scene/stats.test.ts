// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { createStatsSampler, type SplatStats } from './stats';

const READ = { activeSplats: 1200, totalSplats: 5000, calls: 3 };

describe('createStatsSampler', () => {
  it('computes an FPS averaged over the window and relays the read metrics', () => {
    const sampler = createStatsSampler(() => READ, 500);
    const received: SplatStats[] = [];
    sampler.subscribe((s) => received.push(s));
    // 60 fps simulated: one frame every 16.67 ms for ~600 ms.
    for (let t = 0; t <= 600; t += 100 / 6) sampler.frame(t);
    expect(received).toHaveLength(1);
    expect(received[0].fps).toBeCloseTo(60, 0);
    expect(received[0]).toMatchObject(READ);
  });

  it('neither emits nor measures without a subscriber, and restarts from a clean window', () => {
    const read = vi.fn(() => READ);
    const sampler = createStatsSampler(read, 500);
    for (let t = 0; t <= 2000; t += 100) sampler.frame(t);
    expect(read).not.toHaveBeenCalled();
    // Late subscription: the first window starts at the next frame (no skewed FPS).
    const received: SplatStats[] = [];
    sampler.subscribe((s) => received.push(s));
    for (let t = 3000; t <= 3600; t += 100) sampler.frame(t);
    expect(received).toHaveLength(1);
    expect(received[0].fps).toBeCloseTo(10, 0);
  });

  it('unsubscribing stops the emissions', () => {
    const sampler = createStatsSampler(() => READ, 500);
    const cb = vi.fn();
    const off = sampler.subscribe(cb);
    for (let t = 0; t <= 600; t += 100) sampler.frame(t);
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    for (let t = 700; t <= 2000; t += 100) sampler.frame(t);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
