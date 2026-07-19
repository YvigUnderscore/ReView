import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeClipPlane } from './sectionPlane';

/** `distanceToPoint ≥ 0` = conservé par le renderer, `< 0` = coupé. */
describe('sectionPlane — plan de coupe (39.D)', () => {
  it('non flip : conserve le côté coord ≤ position', () => {
    const p = makeClipPlane(THREE, 'x', 2, false);
    expect(p.distanceToPoint(new THREE.Vector3(1, 0, 0))).toBeGreaterThan(0); // gardé
    expect(p.distanceToPoint(new THREE.Vector3(3, 0, 0))).toBeLessThan(0); // coupé
    expect(p.distanceToPoint(new THREE.Vector3(2, 0, 0))).toBeCloseTo(0, 6); // pile sur le plan
  });

  it('flip : conserve le côté coord ≥ position', () => {
    const p = makeClipPlane(THREE, 'x', 2, true);
    expect(p.distanceToPoint(new THREE.Vector3(3, 0, 0))).toBeGreaterThan(0);
    expect(p.distanceToPoint(new THREE.Vector3(1, 0, 0))).toBeLessThan(0);
  });

  it('gère chaque axe (Y, Z)', () => {
    const py = makeClipPlane(THREE, 'y', 0, false);
    expect(py.distanceToPoint(new THREE.Vector3(0, -1, 0))).toBeGreaterThan(0);
    expect(py.distanceToPoint(new THREE.Vector3(0, 1, 0))).toBeLessThan(0);
    const pz = makeClipPlane(THREE, 'z', -1, true);
    expect(pz.distanceToPoint(new THREE.Vector3(0, 0, 0))).toBeGreaterThan(0);
    expect(pz.distanceToPoint(new THREE.Vector3(0, 0, -2))).toBeLessThan(0);
  });
});
