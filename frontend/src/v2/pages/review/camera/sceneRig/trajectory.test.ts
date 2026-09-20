// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { sampleTrajectory, trajSignature } from './trajectory';
import { emptyAnim, upsertKey, type CameraAnimV2 } from '../channels/model';
import type { SplatCamera } from '../../reviewTypes';

const BASE: SplatCamera = { position: { x: 0, y: 7, z: 0 }, target: { x: 0, y: 0, z: 0 } };

/** Deux clés sur `px` : le minimum pour une trajectoire jouable. */
function line(): CameraAnimV2 {
  let a = emptyAnim(false);
  a = upsertKey(a, 'px', 0, 0);
  a = upsertKey(a, 'px', 1000, 10);
  return a;
}

describe('trajSignature', () => {
  it('change quand une clé bouge sur un canal autre que px (la polyligne restait périmée)', () => {
    const a = line();
    const before = trajSignature(a);
    for (const id of ['py', 'pz', 'tx', 'ty', 'tz', 'fov', 'roll'] as const) {
      expect(trajSignature(upsertKey(a, id, 500, 3))).not.toBe(before);
    }
  });

  it('change quand une clé px change de valeur ou de temps', () => {
    const a = line();
    expect(trajSignature(upsertKey(a, 'px', 1000, 11))).not.toBe(trajSignature(a));
    expect(trajSignature(upsertKey(a, 'px', 1200, 10))).not.toBe(trajSignature(a));
  });

  it('change quand la durée de lecture ou la boucle change', () => {
    const a = line();
    expect(trajSignature({ ...a, durationMs: 4000 })).not.toBe(trajSignature(a));
    expect(trajSignature({ ...a, loop: true })).not.toBe(trajSignature(a));
  });

  it('ne change pas pour une animation identique (pas de recalcul inutile)', () => {
    expect(trajSignature(line())).toBe(trajSignature(line()));
  });
});

describe('sampleTrajectory', () => {
  it('ne trace rien avant deux temps de clé', () => {
    expect(sampleTrajectory(emptyAnim(), BASE)).toEqual([]);
    expect(sampleTrajectory(upsertKey(emptyAnim(), 'px', 0, 1), BASE)).toEqual([]);
  });

  it('échantillonne de 0 à la durée de lecture', () => {
    const pts = sampleTrajectory(line(), BASE);
    expect(pts).toHaveLength(65);
    expect(pts[0].x).toBeCloseTo(0, 6);
    expect(pts[64].x).toBeCloseTo(10, 6);
  });

  it('suit la pose de repli pour les canaux sans clé (l’origine était forcée)', () => {
    const pts = sampleTrajectory(line(), BASE);
    for (const p of pts) expect(p.y).toBeCloseTo(7, 6);
  });

  it('suit la durée de lecture réglée, pas seulement le dernier temps de clé', () => {
    const pts = sampleTrajectory({ ...line(), durationMs: 2000 }, BASE);
    // Au-delà de la dernière clé, la valeur est maintenue : la seconde moitié reste à 10.
    expect(pts[32].x).toBeCloseTo(10, 6);
  });
});
