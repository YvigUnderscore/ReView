// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import type * as THREE from 'three';
import { CLICK_SLOP_PX, isClickGesture, pickPrim, primPathOf, toNdc } from './usdPicking';

/** Minimal Three object: only `parent`, `visible` and `userData` are read here. */
const node = (userData: Record<string, unknown>, parent: unknown = null, visible = true) =>
  ({ userData, parent, visible }) as never;

/** Fake Three module: `pickPrim` only uses `Raycaster` and `Vector2`. */
const threeWithHits = (hits: { object: unknown }[]) =>
  ({
    Vector2: class {
      constructor(
        public x: number,
        public y: number,
      ) {}
    },
    Raycaster: class {
      setFromCamera() {}
      intersectObject() {
        return hits;
      }
    },
  }) as unknown as typeof import('three');

const camera = {} as THREE.Camera;
const root = node({});

describe('isClickGesture', () => {
  it('accepts an almost motionless pointer', () => {
    expect(isClickGesture(0, 0)).toBe(true);
    expect(isClickGesture(2, 2)).toBe(true);
  });
  it('rejects a drag — it is an orbit, not a selection', () => {
    expect(isClickGesture(30, 0)).toBe(false);
    expect(isClickGesture(0, CLICK_SLOP_PX + 1)).toBe(false);
  });
});

describe('toNdc', () => {
  const rect = { left: 100, top: 50, width: 800, height: 400 };

  it('places the center at the origin', () => {
    expect(toNdc(500, 250, rect)).toEqual({ x: 0, y: 0 });
  });

  it('inverts the vertical axis (screen to NDC)', () => {
    expect(toNdc(100, 50, rect)).toEqual({ x: -1, y: 1 });
    expect(toNdc(900, 450, rect)).toEqual({ x: 1, y: -1 });
  });

  it('stays defined on a zero-size container', () => {
    expect(toNdc(0, 0, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 });
  });
});

describe('pickPrim', () => {
  const ndc = { x: 0, y: 0 };

  it('returns the prim of the hit object', () => {
    const hit = node({ usdPath: '/World/Asset/Geo/Suzanne' });
    expect(pickPrim(threeWithHits([{ object: hit }]), camera, root, ndc)).toBe('/World/Asset/Geo/Suzanne');
  });

  it('ignores the hidden variant option occupying the same place', () => {
    // Both options are baked into the same GLB: the hidden one is hit first by the ray,
    // but it is not displayed — selecting an invisible prim makes no sense.
    const hidden = node({ usdPath: '/World/Asset/Geo/Cube' }, null, false);
    const shown = node({ usdPath: '/World/Asset/Geo/Suzanne' });
    const path = pickPrim(threeWithHits([{ object: hidden }, { object: shown }]), camera, root, ndc);
    expect(path).toBe('/World/Asset/Geo/Suzanne');
  });

  it('ignores an object hidden by one of its parents', () => {
    const parent = node({ usdPath: '/World/Asset' }, null, false);
    const child = node({ usdPath: '/World/Asset/Geo' }, parent);
    expect(pickPrim(threeWithHits([{ object: child }]), camera, root, ndc)).toBeNull();
  });

  it('returns null when the ray hits nothing', () => {
    expect(pickPrim(threeWithHits([]), camera, root, ndc)).toBeNull();
  });

  it('delegates the translation to a prim to the provided resolver', () => {
    // The viewer plugs its index in there: the raw glTF path may not exist on the USD side.
    const hit = node({ usdPath: '/World/Asset/Geo/Geo/Suzanne' });
    const resolve = () => '/World/Asset/Geo';
    expect(pickPrim(threeWithHits([{ object: hit }]), camera, root, ndc, resolve)).toBe('/World/Asset/Geo');
  });
});

describe('primPathOf', () => {
  it('climbs to the first ancestor carrying a prim path', () => {
    const asset = node({ usdPath: '/World/Asset' });
    const geo = node({}, asset);
    const mesh = node({}, geo);
    expect(primPathOf(mesh)).toBe('/World/Asset');
  });

  it('prefers the path closest to the hit point', () => {
    const asset = node({ usdPath: '/World/Asset' });
    const mesh = node({ usdPath: '/World/Asset/Geo/Suzanne' }, asset);
    expect(primPathOf(mesh)).toBe('/World/Asset/Geo/Suzanne');
  });

  it('returns null outside a USD scene', () => {
    expect(primPathOf(node({}, node({})))).toBeNull();
    expect(primPathOf(null)).toBeNull();
    // A `usdPath` that is not an absolute path is not a prim.
    expect(primPathOf(node({ usdPath: 'Suzanne' }))).toBeNull();
  });
});
