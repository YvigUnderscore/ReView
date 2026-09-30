// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { applyLod, createAutoLod } from './lod';

describe('createAutoLod (machine à états 15 fps / 5 s + hystérésis)', () => {
  it("s'engage après 5 s sous 15 fps, pas avant", () => {
    const auto = createAutoLod();
    for (let i = 0; i < 9; i++) expect(auto.step(10, 500)).toBe(false); // 4,5 s
    expect(auto.step(10, 500)).toBe(true); // 5 s
    expect(auto.engaged).toBe(true);
  });

  it('un retour ponctuel au-dessus du seuil remet le compteur à zéro', () => {
    const auto = createAutoLod();
    for (let i = 0; i < 8; i++) auto.step(10, 500);
    auto.step(30, 500); // répit → compteur remis à zéro
    for (let i = 0; i < 9; i++) expect(auto.step(10, 500)).toBe(false);
    expect(auto.step(10, 500)).toBe(true);
  });

  it("hystérésis : ne se désengage qu'au-dessus de 25 fps pendant 5 s (pas de battement à 20 fps)", () => {
    const auto = createAutoLod();
    for (let i = 0; i < 10; i++) auto.step(10, 500);
    expect(auto.engaged).toBe(true);
    // 20 fps (entre 15 et 25) : reste engagé indéfiniment.
    for (let i = 0; i < 30; i++) expect(auto.step(20, 500)).toBe(true);
    // 30 fps pendant 5 s : désengagé.
    for (let i = 0; i < 9; i++) expect(auto.step(30, 500)).toBe(true);
    expect(auto.step(30, 500)).toBe(false);
  });
});

describe('applyLod', () => {
  it('règle enableLod/enableLodFetching selon le mode', () => {
    const spark = { enableLod: false, enableLodFetching: false };
    applyLod(spark, true, true);
    expect(spark).toEqual({ enableLod: true, enableLodFetching: true });
    applyLod(spark, false, false);
    expect(spark).toEqual({ enableLod: false, enableLodFetching: false });
  });
});
