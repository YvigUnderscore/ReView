// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { createSampler } from './statsSampler';

const READ = { calls: 12, triangles: 900_000, geometries: 8, textures: 5 };

describe('statsSampler.createSampler', () => {
  it('moyenne le FPS sur la fenêtre et relaie les compteurs lus', () => {
    const sampler = createSampler(() => READ, 500);
    const received: ({ fps: number } & typeof READ)[] = [];
    sampler.subscribe((s) => received.push(s));
    for (let t = 0; t <= 600; t += 100 / 6) sampler.frame(t); // 60 fps simulés
    expect(received).toHaveLength(1);
    expect(received[0].fps).toBeCloseTo(60, 0);
    expect(received[0]).toMatchObject(READ);
  });

  it('ne mesure rien sans abonné (panneau fermé = coût nul)', () => {
    const read = vi.fn(() => READ);
    const sampler = createSampler(read, 500);
    for (let t = 0; t <= 2000; t += 100) sampler.frame(t);
    expect(read).not.toHaveBeenCalled();
  });

  it('repart d’une fenêtre propre après un abonnement tardif, et s’arrête au désabonnement', () => {
    const sampler = createSampler(() => READ, 500);
    const cb = vi.fn();
    for (let t = 0; t <= 2000; t += 100) sampler.frame(t);
    const off = sampler.subscribe(cb);
    for (let t = 3000; t <= 3600; t += 100) sampler.frame(t);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].fps).toBeCloseTo(10, 0);
    off();
    for (let t = 4000; t <= 5000; t += 100) sampler.frame(t);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
