// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import type * as THREE from 'three';
import {
  applyPlan,
  indexPrimObjects,
  isDrawn,
  makePrimResolver,
  planOverride,
  renderedPrimPaths,
  transformDeltaFrom,
  variantOptionRenderable,
  type BaseState,
  type IndexedObject,
} from './sceneOverrideApply';
import { emptyOverride, setPrimEdit, type SceneOverride } from './sceneOverride';

const base = (over: Partial<BaseState> = {}): BaseState => ({
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
  visible: true,
  ...over,
});

const indexed = (entries: [string, Partial<BaseState>?][]): IndexedObject<string>[] =>
  entries.map(([primPath, b]) => ({ object: primPath, primPath, base: base(b) }));

describe('planOverride', () => {
  it('without an override, each object keeps its original state', () => {
    const plans = planOverride(indexed([['/W/A', { position: [1, 2, 3] }]]), null);
    expect(plans[0]).toMatchObject({ position: [1, 2, 3], scale: [1, 1, 1], visible: true });
  });

  it('translation and rotation add up, scale multiplies', () => {
    const override = setPrimEdit(emptyOverride(), '/W/A', {
      transform: { t: [1, 0, 0], r: [0, Math.PI, 0], s: [2, 2, 2] },
    });
    const plans = planOverride(indexed([['/W/A', { position: [5, 0, 0], scale: [3, 3, 3] }]]), override);
    expect(plans[0].position).toEqual([6, 0, 0]);
    expect(plans[0].rotation[1]).toBeCloseTo(Math.PI);
    expect(plans[0].scale).toEqual([6, 6, 6]);
  });

  it('forced visibility wins, otherwise the original one is kept', () => {
    const override = setPrimEdit(emptyOverride(), '/W/A', { visible: false });
    const plans = planOverride(indexed([['/W/A'], ['/W/B', { visible: false }]]), override);
    expect(plans[0].visible).toBe(false);
    expect(plans[1].visible).toBe(false);
  });

  it('applies the delta only to the targeted prim', () => {
    const override = setPrimEdit(emptyOverride(), '/W/A', {
      transform: { t: [9, 9, 9], r: [0, 0, 0], s: [1, 1, 1] },
    });
    const plans = planOverride(indexed([['/W/A'], ['/W/B']]), override);
    expect(plans[0].position).toEqual([9, 9, 9]);
    expect(plans[1].position).toEqual([0, 0, 0]);
  });

  it('is idempotent: replanning from the original state does not accumulate', () => {
    const items = indexed([['/W/A']]);
    const override = setPrimEdit(emptyOverride(), '/W/A', {
      transform: { t: [1, 0, 0], r: [0, 0, 0], s: [1, 1, 1] },
    });
    expect(planOverride(items, override)[0].position).toEqual([1, 0, 0]);
    expect(planOverride(items, override)[0].position).toEqual([1, 0, 0]);
  });

  it('reverting to an empty override restores the original state', () => {
    const items = indexed([['/W/A', { position: [4, 0, 0] }]]);
    const override = setPrimEdit(emptyOverride(), '/W/A', {
      transform: { t: [1, 1, 1], r: [0, 0, 0], s: [1, 1, 1] },
    });
    expect(planOverride(items, override)[0].position).toEqual([5, 1, 1]);
    expect(planOverride(items, emptyOverride())[0].position).toEqual([4, 0, 0]);
  });
});

describe('variants baked into the GLB (46.G)', () => {
  const defaults = { '/W/Asset': { modelingVariant: 'hero' } };
  const scene: IndexedObject<string>[] = [
    {
      object: 'hero',
      primPath: '/W/Asset/Geo',
      base: base(),
      variant: { prim: '/W/Asset', selections: { modelingVariant: 'hero' } },
    },
    {
      object: 'lo',
      primPath: '/W/Asset/Geo',
      base: base(),
      variant: { prim: '/W/Asset', selections: { modelingVariant: 'lo' } },
    },
    { object: 'commun', primPath: '/W/Asset', base: base() },
  ];

  it('only the active option is visible, the other is hidden', () => {
    const plans = planOverride(scene, null, defaults);
    expect(plans.map((p) => [p.object, p.visible])).toEqual([
      ['hero', true],
      ['lo', false],
      ['commun', true],
    ]);
  });

  it('switching variant toggles visibility without reconversion', () => {
    const override = setPrimEdit(emptyOverride(), '/W/Asset', { variants: { modelingVariant: 'lo' } });
    const plans = planOverride(scene, override, defaults);
    expect(plans.map((p) => [p.object, p.visible])).toEqual([
      ['hero', false],
      ['lo', true],
      ['commun', true],
    ]);
  });

  it('a non-kept option stays hidden even if the override asks for it visible', () => {
    const override = setPrimEdit(emptyOverride(), '/W/Asset/Geo', { visible: true });
    expect(planOverride(scene, override, defaults)[1].visible).toBe(false);
  });

  it('without a known default, no option is kept', () => {
    expect(planOverride(scene, null, {}).map((p) => p.visible)).toEqual([false, false, true]);
  });
});

describe('prims with several variant sets (46.R — Kitchen_set plates)', () => {
  // A plate carries modelingVariant (PlateA/PlateB) AND shadingVariant (Clean/Dirty).
  const prim = '/K/PlateBClean_1';
  const defaults = { [prim]: { modelingVariant: 'PlateB', shadingVariant: 'Clean' } };
  const scene: IndexedObject<string>[] = [
    // Base scene: composed with both sets at their default.
    {
      object: 'base',
      primPath: `${prim}/Geo`,
      base: base(),
      variant: { prim, selections: { modelingVariant: 'PlateB', shadingVariant: 'Clean' } },
    },
    // Modeling option baked (shading left at default during baking).
    {
      object: 'plateA',
      primPath: `${prim}/Geo`,
      base: base(),
      variant: { prim, selections: { modelingVariant: 'PlateA', shadingVariant: 'Clean' } },
    },
    // Shading option baked (modeling left at default).
    {
      object: 'dirty',
      primPath: `${prim}/Geo`,
      base: base(),
      variant: { prim, selections: { modelingVariant: 'PlateB', shadingVariant: 'Dirty' } },
    },
  ];
  const visible = (override: SceneOverride | null) =>
    planOverride(scene, override, defaults)
      .filter((p) => p.visible)
      .map((p) => p.object);

  it('at default, only the base scene is visible', () => {
    expect(visible(null)).toEqual(['base']);
  });

  it('changing one set hides the base — no more duplicated geometry', () => {
    // That was the bug: the base only carried one membership (overwritten), so it stayed
    // displayed next to the baked option — two plates on screen.
    const override = setPrimEdit(emptyOverride(), prim, { variants: { modelingVariant: 'PlateA' } });
    expect(visible(override)).toEqual(['plateA']);
  });

  it('changing the other set toggles to its option, alone', () => {
    const override = setPrimEdit(emptyOverride(), prim, { variants: { shadingVariant: 'Dirty' } });
    expect(visible(override)).toEqual(['dirty']);
  });

  it('an uncooked combination shows nothing rather than a false mix', () => {
    const override = setPrimEdit(emptyOverride(), prim, {
      variants: { modelingVariant: 'PlateA', shadingVariant: 'Dirty' },
    });
    expect(visible(override)).toEqual([]);
  });

  describe('variantOptionRenderable (46.U — the menu greys out instead of making things disappear)', () => {
    const renderable = (override: SceneOverride | null, set: string, option: string) =>
      variantOptionRenderable(scene, override, defaults, prim, set, option);

    it('at default, each individually baked option is displayable', () => {
      expect(renderable(null, 'modelingVariant', 'PlateA')).toBe(true);
      expect(renderable(null, 'shadingVariant', 'Dirty')).toBe(true);
      expect(renderable(null, 'shadingVariant', 'Clean')).toBe(true);
    });

    it('PlateA kept: Dirty becomes an uncooked combination — greyed out', () => {
      const override = setPrimEdit(emptyOverride(), prim, { variants: { modelingVariant: 'PlateA' } });
      expect(renderable(override, 'shadingVariant', 'Dirty')).toBe(false);
      // Going back to the default shading remains possible (the PlateA subtree carries it).
      expect(renderable(override, 'shadingVariant', 'Clean')).toBe(true);
    });

    it('Dirty kept: PlateA greyed out, going back to PlateB possible', () => {
      const override = setPrimEdit(emptyOverride(), prim, { variants: { shadingVariant: 'Dirty' } });
      expect(renderable(override, 'modelingVariant', 'PlateA')).toBe(false);
      expect(renderable(override, 'modelingVariant', 'PlateB')).toBe(true);
    });

    it('an option never baked is not displayable', () => {
      expect(renderable(null, 'modelingVariant', 'PlateZ')).toBe(false);
    });

    it('without a known carrier of the set (old untagged GLB), blocks nothing', () => {
      const unlabeled = indexed([[`${prim}/Geo`]]);
      expect(variantOptionRenderable(unlabeled, null, defaults, prim, 'shadingVariant', 'Dirty')).toBe(true);
    });
  });
});

/**
 * Fake `Object3D`: the seam between the imperative scene and the pure logic boils down to
 * `traverse`, `userData` and three vectors — enough to check indexing without WebGL.
 */
interface FakeVec {
  x: number;
  y: number;
  z: number;
  set(x: number, y: number, z: number): void;
}

interface FakeNode {
  userData: Record<string, unknown>;
  position: FakeVec;
  rotation: FakeVec;
  scale: FakeVec;
  visible: boolean;
  children: FakeNode[];
  parent: FakeNode | null;
  traverse(cb: (o: unknown) => void): void;
}

function fakeObject(userData: Record<string, unknown>, children: FakeNode[] = []): FakeNode {
  const vec = (x = 0, y = 0, z = 0): FakeVec => {
    const v: FakeVec = {
      x,
      y,
      z,
      set: (a, b, c) => {
        Object.assign(v, { x: a, y: b, z: c });
      },
    };
    return v;
  };
  const node: FakeNode = {
    userData,
    position: vec(),
    rotation: vec(),
    scale: vec(1, 1, 1),
    visible: true,
    children,
    parent: null,
    traverse(cb) {
      cb(node);
      for (const child of children) child.traverse(cb);
    },
  };
  for (const child of children) child.parent = node;
  return node;
}

const asObject3D = (o: FakeNode) => o as unknown as THREE.Object3D;

describe('indexPrimObjects', () => {
  it('indexes objects carrying a usdPath and ignores the others', () => {
    const root = fakeObject({}, [fakeObject({ usdPath: '/World/Asset/Geo' }), fakeObject({ nothing: true })]);
    const indexedObjects = indexPrimObjects(asObject3D(root), ['/World/Asset/Geo']);
    expect(indexedObjects.map((i) => i.primPath)).toEqual(['/World/Asset/Geo']);
  });

  it('records the original state, the reference of the idempotent delta', () => {
    const child = fakeObject({ usdPath: '/W/A' });
    child.position.set(1, 2, 3);
    child.visible = false;
    const [entry] = indexPrimObjects(asObject3D(fakeObject({}, [child])), ['/W/A']);
    expect(entry.base).toMatchObject({ position: [1, 2, 3], scale: [1, 1, 1], visible: false });
  });

  it('reads multi-set memberships (46.R) like the legacy single-set format', () => {
    const multi = fakeObject({
      usdPath: '/K/Plate_1/Geo',
      usdVariantPrim: '/K/Plate_1',
      usdVariants: 'modelingVariant=PlateA;shadingVariant=Dirty',
    });
    const legacy = fakeObject({
      usdPath: '/W/Asset/Geo',
      usdVariantPrim: '/W/Asset',
      usdVariantSet: 'modelingVariant',
      usdVariantOption: 'lo',
    });
    const [a, b] = indexPrimObjects(asObject3D(fakeObject({}, [multi, legacy])), []);
    expect(a.variant).toEqual({
      prim: '/K/Plate_1',
      selections: { modelingVariant: 'PlateA', shadingVariant: 'Dirty' },
    });
    expect(b.variant).toEqual({ prim: '/W/Asset', selections: { modelingVariant: 'lo' } });
  });

  it('falls back to the raw path when no USD prim matches', () => {
    const child = fakeObject({ usdPath: '/Inconnu/Truc' });
    const [entry] = indexPrimObjects(asObject3D(fakeObject({}, [child])), ['/W/A']);
    expect(entry.primPath).toBe('/Inconnu/Truc');
  });
});

describe('applyPlan', () => {
  it('writes position, rotation, scale and visibility to the scene', () => {
    const child = fakeObject({ usdPath: '/W/A' });
    const items = indexPrimObjects(asObject3D(fakeObject({}, [child])), ['/W/A']);
    const override = setPrimEdit(emptyOverride(), '/W/A', {
      visible: false,
      transform: { t: [1, 2, 3], r: [0, 0, 0], s: [2, 2, 2] },
    });
    applyPlan(planOverride(items, override));
    expect([child.position.x, child.position.y, child.position.z]).toEqual([1, 2, 3]);
    expect(child.scale.x).toBe(2);
    expect(child.visible).toBe(false);
  });
});

describe('makePrimResolver', () => {
  it('climbs from the hit mesh up to the indexed prim', () => {
    const mesh = fakeObject({});
    const geo = fakeObject({ usdPath: '/W/Asset/Geo/Geo' }, [mesh]);
    const items = indexPrimObjects(asObject3D(fakeObject({}, [geo])), ['/W/Asset/Geo']);
    // The glTF path has one extra level: the index has already restored the real USD prim.
    expect(items[0].primPath).toBe('/W/Asset/Geo');
    expect(makePrimResolver(items)(asObject3D(mesh))).toBe('/W/Asset/Geo');
  });

  it('returns null for an object outside the USD scene', () => {
    expect(makePrimResolver([])(asObject3D(fakeObject({})))).toBeNull();
  });
});

describe('transformDeltaFrom', () => {
  it('is the exact inverse of planOverride: base + delta gives back the manipulated pose', () => {
    const origin = base({ position: [1, 0, 0], rotation: [0, 0.5, 0], scale: [2, 2, 2] });
    const pose = {
      position: { x: 3, y: 1, z: 0 },
      rotation: { x: 0, y: 1.5, z: 0 },
      scale: { x: 4, y: 2, z: 2 },
    };
    const delta = transformDeltaFrom(origin, pose);
    expect(delta.t).toEqual([2, 1, 0]);
    expect(delta.r[1]).toBeCloseTo(1);
    expect(delta.s).toEqual([2, 1, 1]);
    // Round trip through planOverride: the object comes back exactly to the gizmo's pose.
    const override = setPrimEdit(emptyOverride(), '/W/A', { transform: delta });
    const plan = planOverride(
      [{ object: 'o', primPath: '/W/A', base: origin }] as IndexedObject<string>[],
      override,
    )[0];
    expect(plan.position).toEqual([3, 1, 0]);
    expect(plan.rotation[1]).toBeCloseTo(1.5);
    expect(plan.scale).toEqual([4, 2, 2]);
  });

  it('unchanged pose → identity delta (so nothing to store)', () => {
    const origin = base({ position: [5, 5, 5] });
    const delta = transformDeltaFrom(origin, {
      position: { x: 5, y: 5, z: 5 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
    expect(delta).toEqual({ t: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] });
  });

  it('does not produce NaN on a zero-scale base', () => {
    const delta = transformDeltaFrom(base({ scale: [0, 1, 1] }), {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 2, y: 2, z: 2 },
    });
    expect(delta.s).toEqual([1, 2, 2]);
  });
});

describe('isDrawn', () => {
  it('follows inherited visibility: a child of a hidden object is no longer drawn', () => {
    const child = fakeObject({ usdPath: '/W/A/Mesh' });
    const parent = fakeObject({ usdPath: '/W/A' }, [child]);
    expect(isDrawn(asObject3D(child))).toBe(true);
    parent.visible = false;
    // Three does not touch the children's `visible`: without walking up, the halo would stay
    // displayed around an object that became invisible.
    expect(child.visible).toBe(true);
    expect(isDrawn(asObject3D(child))).toBe(false);
  });

  it('a hidden object itself is not drawn', () => {
    const object = fakeObject({});
    object.visible = false;
    expect(isDrawn(asObject3D(object))).toBe(false);
  });
});

describe('renderedPrimPaths', () => {
  it('deduplicates the paths of the rendered objects', () => {
    expect(renderedPrimPaths(indexed([['/W/A'], ['/W/A'], ['/W/B']]))).toEqual(['/W/A', '/W/B']);
  });
});
