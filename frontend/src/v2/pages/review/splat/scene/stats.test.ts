// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { createStatsSampler, type SplatStats } from './stats';

const READ = { activeSplats: 1200, totalSplats: 5000, calls: 3 };

describe('createStatsSampler', () => {
  it('calcule un FPS moyenné sur la fenêtre et relaie les métriques lues', () => {
    const sampler = createStatsSampler(() => READ, 500);
    const received: SplatStats[] = [];
    sampler.subscribe((s) => received.push(s));
    // 60 fps simulés : une frame toutes les 16,67 ms pendant ~600 ms.
    for (let t = 0; t <= 600; t += 100 / 6) sampler.frame(t);
    expect(received).toHaveLength(1);
    expect(received[0].fps).toBeCloseTo(60, 0);
    expect(received[0]).toMatchObject(READ);
  });

  it("n'émet ni ne mesure sans abonné, et repart d'une fenêtre propre", () => {
    const read = vi.fn(() => READ);
    const sampler = createStatsSampler(read, 500);
    for (let t = 0; t <= 2000; t += 100) sampler.frame(t);
    expect(read).not.toHaveBeenCalled();
    // Abonnement tardif : la première fenêtre démarre au prochain frame (pas de FPS faussé).
    const received: SplatStats[] = [];
    sampler.subscribe((s) => received.push(s));
    for (let t = 3000; t <= 3600; t += 100) sampler.frame(t);
    expect(received).toHaveLength(1);
    expect(received[0].fps).toBeCloseTo(10, 0);
  });

  it('le désabonnement arrête les émissions', () => {
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
