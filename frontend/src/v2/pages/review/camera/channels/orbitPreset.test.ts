// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { ORBIT_DURATION_MS, orbitPresetV2, orbitStartFromView } from './orbitPreset';
import { sampleAnimV2 } from './hermite';
import { animKeyTimes, CHANNEL_IDS, hasAnimation, type CameraAnimV2 } from './model';
import type { SplatCamera } from '../../reviewTypes';

/**
 * L'orbite doit être un cercle parcouru à vitesse constante : c'est la sonde qui a chiffré le
 * défaut (rayon modulé de 4,9 %, vitesse de 16 %, cassure de 45° au bouclage) qui sert ici de
 * test. Échantillonnage dense de l'animation réellement produite, via `sampleAnimV2`.
 */

const BASE: SplatCamera = { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } };

/** Vue à 10 unités de la cible, élevée de 3 — un cadrage d'orbite ordinaire. */
const view = (over: Partial<SplatCamera> = {}): SplatCamera => ({
  position: { x: 9, y: 3, z: 4 },
  target: { x: 1, y: 0.5, z: -2 },
  fov: 50,
  ...over,
});

/** Échantillonne l'orbite en `steps` points et rend les poses (une par temps croissant). */
function samples(anim: CameraAnimV2, steps: number) {
  const out = [];
  for (let i = 0; i <= steps; i++) out.push(sampleAnimV2(anim, (i / steps) * ORBIT_DURATION_MS, BASE));
  return out;
}

describe('orbitStartFromView', () => {
  it('reprend le turntable : rayon horizontal, hauteur, distance à la cible conservée', () => {
    const v = view();
    const start = orbitStartFromView(v);
    expect(start.center).toEqual(v.target);
    expect(start.radius).toBeCloseTo(Math.hypot(9 - 1, 4 + 2), 10);
    expect(start.height).toBeCloseTo(3 - 0.5, 10);
    expect(Math.hypot(start.radius, start.height)).toBeCloseTo(Math.hypot(9 - 1, 3 - 0.5, 4 + 2), 10);
  });

  it('depuis une vue plongeante verticale, garde la distance au lieu de retomber à 1 unité', () => {
    const v = view({ position: { x: 1, y: 20.5, z: -2 } }); // pile au-dessus de la cible
    const start = orbitStartFromView(v);
    // Le défaut : rayon = 1 et orbite à une autre échelle. La distance, elle, est intacte.
    expect(start.radius).toBeGreaterThan(10);
    expect(Math.hypot(start.radius, start.height)).toBeCloseTo(20, 10);
    expect(start.height).toBeGreaterThan(0); // la caméra reste au-dessus
  });

  it('garde la caméra sous la cible quand elle la survole par le bas', () => {
    const start = orbitStartFromView(view({ position: { x: 1, y: -19.5, z: -2 } }));
    expect(start.height).toBeLessThan(0);
    expect(Math.hypot(start.radius, start.height)).toBeCloseTo(20, 10);
  });
});

describe('orbitPresetV2', () => {
  it('est jouable et boucle', () => {
    const anim = orbitPresetV2(view());
    expect(hasAnimation(anim)).toBe(true);
    expect(anim.loop).toBe(true);
    expect(animKeyTimes(anim)).toEqual([0, 1500, 3000, 4500, 6000, 7500, 9000, 10500, 12000]);
  });

  it('garde un rayon constant (l’ancien preset le modulait de 4,9 %)', () => {
    const v = view();
    const r = orbitStartFromView(v).radius;
    const radii = samples(orbitPresetV2(v), 720).map((p) =>
      Math.hypot(p.position.x - v.target.x, p.position.z - v.target.z),
    );
    for (const rad of radii) expect(Math.abs(rad - r)).toBeLessThan(0.05);
    expect((Math.max(...radii) - Math.min(...radii)) / r).toBeLessThan(0.01);
  });

  it('garde une vitesse constante à 1 % près (l’ancien preset variait de 16 %)', () => {
    const poses = samples(orbitPresetV2(view()), 720);
    const speeds: number[] = [];
    for (let i = 1; i < poses.length; i++) {
      const a = poses[i - 1].position;
      const b = poses[i].position;
      speeds.push(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
    }
    const mean = speeds.reduce((s, v) => s + v, 0) / speeds.length;
    for (const s of speeds) expect(Math.abs(s - mean) / mean).toBeLessThan(0.01);
  });

  it('boucle sans cassure de direction (45° à chaque tour avant)', () => {
    const anim = orbitPresetV2(view());
    const step = 4;
    const before = sampleAnimV2(anim, ORBIT_DURATION_MS - step, BASE).position;
    const end = sampleAnimV2(anim, ORBIT_DURATION_MS, BASE).position;
    const after = sampleAnimV2(anim, step, BASE).position;
    const inDir = { x: end.x - before.x, z: end.z - before.z };
    const outDir = { x: after.x - end.x, z: after.z - end.z };
    const cos =
      (inDir.x * outDir.x + inDir.z * outDir.z) /
      (Math.hypot(inDir.x, inDir.z) * Math.hypot(outDir.x, outDir.z));
    expect(Math.acos(Math.min(1, cos)) * (180 / Math.PI)).toBeLessThan(1);
  });

  it('n’écrit qu’une clé par canal constant (45 clés constantes avant)', () => {
    const anim = orbitPresetV2(view());
    const count = (id: (typeof CHANNEL_IDS)[number]) => anim.channels[id]?.keys.length ?? 0;
    expect(count('px')).toBe(9);
    expect(count('pz')).toBe(9);
    for (const id of ['py', 'tx', 'ty', 'tz', 'fov'] as const) expect(count(id)).toBe(1);
    expect(count('roll')).toBe(0); // horizon droit : la vue ne porte pas de tilt
    const total = CHANNEL_IDS.reduce((n, id) => n + count(id), 0);
    expect(total).toBe(23);
  });

  it('les canaux constants restent constants malgré leur clé unique', () => {
    const v = view();
    const poses = samples(orbitPresetV2(v), 200);
    for (const p of poses) {
      expect(p.position.y).toBeCloseTo(v.position.y, 6);
      expect(p.target.x).toBeCloseTo(v.target.x, 6);
      expect(p.target.y).toBeCloseTo(v.target.y, 6);
      expect(p.target.z).toBeCloseTo(v.target.z, 6);
      expect(p.fov).toBeCloseTo(50, 6);
    }
  });

  it('écrit le tilt quand la vue en porte un (rejeu déterministe, la pose de base n’est pas persistée)', () => {
    const anim = orbitPresetV2(view({ roll: 0.2 }));
    expect(anim.channels.roll?.keys).toHaveLength(1);
    expect(sampleAnimV2(anim, 5000, BASE).roll).toBeCloseTo(0.2, 6);
  });
});
