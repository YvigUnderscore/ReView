// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { emptyAnim, setChannelExtrapolation, upsertKey, type CameraAnimV2 } from './model';
import { evalChannel } from './hermite';
import { extrapolateValue } from './extrapolate';

/** Deux clés linéaires : 0 → 10 sur une seconde, donc une pente de 0,01 unité/ms. */
const ramp = (): CameraAnimV2 =>
  upsertKey(upsertKey(emptyAnim(), 'px', 0, 0, 'linear'), 'px', 1000, 10, 'linear');

const at = (a: CameraAnimV2, t: number) => evalChannel(a.channels.px, t, 0);

describe('extrapolate — défaut constant', () => {
  it('sans réglage, la courbe tient sa valeur extrême (comportement d’origine)', () => {
    const a = ramp();
    expect(at(a, -500)).toBe(0);
    expect(at(a, 1500)).toBe(10);
  });

  it('« constant » n’écrit rien : le canal retrouve sa forme d’origine', () => {
    let a = setChannelExtrapolation(ramp(), 'px', { pre: 'cycle', post: 'cycle' });
    expect(a.channels.px?.pre).toBe('cycle');
    a = setChannelExtrapolation(a, 'px', { pre: 'constant', post: 'constant' });
    expect(a.channels.px?.pre).toBeUndefined();
    expect(a.channels.px?.post).toBeUndefined();
    expect(at(a, 1500)).toBe(10);
  });
});

describe('extrapolate — cycles et prolongations', () => {
  it('cycle rejoue la courbe des deux côtés', () => {
    const a = setChannelExtrapolation(ramp(), 'px', { pre: 'cycle', post: 'cycle' });
    expect(at(a, 1500)).toBeCloseTo(5, 6);
    expect(at(a, -500)).toBeCloseTo(5, 6);
  });

  it('cycle avec décalage cumule l’écart de la période', () => {
    const a = setChannelExtrapolation(ramp(), 'px', { pre: 'cycleOffset', post: 'cycleOffset' });
    expect(at(a, 1500)).toBeCloseTo(15, 6);
    expect(at(a, 2500)).toBeCloseTo(25, 6);
    expect(at(a, -500)).toBeCloseTo(-5, 6);
  });

  it('linéaire prolonge la pente qui touche la courbe', () => {
    const a = setChannelExtrapolation(ramp(), 'px', { pre: 'linear', post: 'linear' });
    expect(at(a, 1500)).toBeCloseTo(15, 6);
    expect(at(a, -500)).toBeCloseTo(-5, 6);
  });

  it('oscillation va et vient (un aller-retour par période)', () => {
    const a = setChannelExtrapolation(ramp(), 'px', { pre: 'oscillate', post: 'oscillate' });
    expect(at(a, 1200)).toBeCloseTo(8, 6);
    expect(at(a, 2200)).toBeCloseTo(2, 6);
    expect(at(a, -200)).toBeCloseTo(2, 6);
  });

  it('une courbe sans étendue temporelle n’a pas de cycle à rejouer', () => {
    const keys = [
      { t: 500, v: 3, mode: 'auto' as const },
      { t: 500, v: 7, mode: 'auto' as const },
    ];
    expect(extrapolateValue(keys, 'cycle', 'post', 900, () => 42)).toBe(7);
    expect(extrapolateValue(keys, 'oscillate', 'pre', 100, () => 42)).toBe(3);
  });
});
