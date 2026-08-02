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
  it('sans override, chaque objet garde son état d’origine', () => {
    const plans = planOverride(indexed([['/W/A', { position: [1, 2, 3] }]]), null);
    expect(plans[0]).toMatchObject({ position: [1, 2, 3], scale: [1, 1, 1], visible: true });
  });

  it('la translation et la rotation s’ajoutent, l’échelle se multiplie', () => {
    const override = setPrimEdit(emptyOverride(), '/W/A', {
      transform: { t: [1, 0, 0], r: [0, Math.PI, 0], s: [2, 2, 2] },
    });
    const plans = planOverride(indexed([['/W/A', { position: [5, 0, 0], scale: [3, 3, 3] }]]), override);
    expect(plans[0]!.position).toEqual([6, 0, 0]);
    expect(plans[0]!.rotation[1]).toBeCloseTo(Math.PI);
    expect(plans[0]!.scale).toEqual([6, 6, 6]);
  });

  it('la visibilité forcée l’emporte, sinon celle d’origine est conservée', () => {
    const override = setPrimEdit(emptyOverride(), '/W/A', { visible: false });
    const plans = planOverride(indexed([['/W/A'], ['/W/B', { visible: false }]]), override);
    expect(plans[0]!.visible).toBe(false);
    expect(plans[1]!.visible).toBe(false);
  });

  it('n’applique le delta qu’au prim visé', () => {
    const override = setPrimEdit(emptyOverride(), '/W/A', {
      transform: { t: [9, 9, 9], r: [0, 0, 0], s: [1, 1, 1] },
    });
    const plans = planOverride(indexed([['/W/A'], ['/W/B']]), override);
    expect(plans[0]!.position).toEqual([9, 9, 9]);
    expect(plans[1]!.position).toEqual([0, 0, 0]);
  });

  it('est idempotent : replanifier depuis l’état d’origine ne cumule pas', () => {
    const items = indexed([['/W/A']]);
    const override = setPrimEdit(emptyOverride(), '/W/A', {
      transform: { t: [1, 0, 0], r: [0, 0, 0], s: [1, 1, 1] },
    });
    expect(planOverride(items, override)[0]!.position).toEqual([1, 0, 0]);
    expect(planOverride(items, override)[0]!.position).toEqual([1, 0, 0]);
  });

  it('revenir à un override vide rétablit l’état d’origine', () => {
    const items = indexed([['/W/A', { position: [4, 0, 0] }]]);
    const override = setPrimEdit(emptyOverride(), '/W/A', {
      transform: { t: [1, 1, 1], r: [0, 0, 0], s: [1, 1, 1] },
    });
    expect(planOverride(items, override)[0]!.position).toEqual([5, 1, 1]);
    expect(planOverride(items, emptyOverride())[0]!.position).toEqual([4, 0, 0]);
  });
});

describe('variantes cuites dans le GLB (46.G)', () => {
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

  it('seule l’option active est visible, l’autre est masquée', () => {
    const plans = planOverride(scene, null, defaults);
    expect(plans.map((p) => [p.object, p.visible])).toEqual([
      ['hero', true],
      ['lo', false],
      ['commun', true],
    ]);
  });

  it('changer de variante bascule la visibilité sans reconversion', () => {
    const override = setPrimEdit(emptyOverride(), '/W/Asset', { variants: { modelingVariant: 'lo' } });
    const plans = planOverride(scene, override, defaults);
    expect(plans.map((p) => [p.object, p.visible])).toEqual([
      ['hero', false],
      ['lo', true],
      ['commun', true],
    ]);
  });

  it('une option non retenue reste masquée même si l’override la demande visible', () => {
    const override = setPrimEdit(emptyOverride(), '/W/Asset/Geo', { visible: true });
    expect(planOverride(scene, override, defaults)[1]!.visible).toBe(false);
  });

  it('sans défaut connu, aucune option n’est retenue', () => {
    expect(planOverride(scene, null, {}).map((p) => p.visible)).toEqual([false, false, true]);
  });
});

describe('prims à plusieurs jeux de variantes (46.R — assiettes Kitchen_set)', () => {
  // Une assiette porte modelingVariant (PlateA/PlateB) ET shadingVariant (Clean/Dirty).
  const prim = '/K/PlateBClean_1';
  const defaults = { [prim]: { modelingVariant: 'PlateB', shadingVariant: 'Clean' } };
  const scene: IndexedObject<string>[] = [
    // Scène de base : composée avec les deux jeux à leur défaut.
    {
      object: 'base',
      primPath: `${prim}/Geo`,
      base: base(),
      variant: { prim, selections: { modelingVariant: 'PlateB', shadingVariant: 'Clean' } },
    },
    // Option modeling cuite (shading resté au défaut pendant la cuisson).
    {
      object: 'plateA',
      primPath: `${prim}/Geo`,
      base: base(),
      variant: { prim, selections: { modelingVariant: 'PlateA', shadingVariant: 'Clean' } },
    },
    // Option shading cuite (modeling resté au défaut).
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

  it('au défaut, seule la scène de base est visible', () => {
    expect(visible(null)).toEqual(['base']);
  });

  it('changer un jeu masque la base — plus de géométrie en double', () => {
    // C'était le bug : la base ne portait qu'une appartenance (écrasée), donc elle restait
    // affichée à côté de l'option cuite — deux assiettes à l'écran.
    const override = setPrimEdit(emptyOverride(), prim, { variants: { modelingVariant: 'PlateA' } });
    expect(visible(override)).toEqual(['plateA']);
  });

  it('changer l’autre jeu bascule vers son option, seule', () => {
    const override = setPrimEdit(emptyOverride(), prim, { variants: { shadingVariant: 'Dirty' } });
    expect(visible(override)).toEqual(['dirty']);
  });

  it('une combinaison non cuite ne montre rien plutôt qu’un mélange faux', () => {
    const override = setPrimEdit(emptyOverride(), prim, {
      variants: { modelingVariant: 'PlateA', shadingVariant: 'Dirty' },
    });
    expect(visible(override)).toEqual([]);
  });

  describe('variantOptionRenderable (46.U — le menu grise au lieu de faire disparaître)', () => {
    const renderable = (override: SceneOverride | null, set: string, option: string) =>
      variantOptionRenderable(scene, override, defaults, prim, set, option);

    it('au défaut, chaque option cuite individuellement est montrable', () => {
      expect(renderable(null, 'modelingVariant', 'PlateA')).toBe(true);
      expect(renderable(null, 'shadingVariant', 'Dirty')).toBe(true);
      expect(renderable(null, 'shadingVariant', 'Clean')).toBe(true);
    });

    it('PlateA retenu : Dirty devient une combinaison non cuite — grisé', () => {
      const override = setPrimEdit(emptyOverride(), prim, { variants: { modelingVariant: 'PlateA' } });
      expect(renderable(override, 'shadingVariant', 'Dirty')).toBe(false);
      // Revenir au shading par défaut reste possible (le sous-arbre PlateA le porte).
      expect(renderable(override, 'shadingVariant', 'Clean')).toBe(true);
    });

    it('Dirty retenu : PlateA grisé, retour à PlateB possible', () => {
      const override = setPrimEdit(emptyOverride(), prim, { variants: { shadingVariant: 'Dirty' } });
      expect(renderable(override, 'modelingVariant', 'PlateA')).toBe(false);
      expect(renderable(override, 'modelingVariant', 'PlateB')).toBe(true);
    });

    it('une option jamais cuite n’est pas montrable', () => {
      expect(renderable(null, 'modelingVariant', 'PlateZ')).toBe(false);
    });

    it('sans porteur connu du jeu (vieux GLB non étiqueté), ne bloque rien', () => {
      const unlabeled = indexed([[`${prim}/Geo`]]);
      expect(variantOptionRenderable(unlabeled, null, defaults, prim, 'shadingVariant', 'Dirty')).toBe(true);
    });
  });
});

/**
 * Faux `Object3D` : la couture entre la scène impérative et la logique pure se réduit à
 * `traverse`, `userData` et trois vecteurs — assez pour vérifier l'indexation sans WebGL.
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
  it('indexe les objets porteurs d’un usdPath et ignore les autres', () => {
    const root = fakeObject({}, [fakeObject({ usdPath: '/World/Asset/Geo' }), fakeObject({ nothing: true })]);
    const indexedObjects = indexPrimObjects(asObject3D(root), ['/World/Asset/Geo']);
    expect(indexedObjects.map((i) => i.primPath)).toEqual(['/World/Asset/Geo']);
  });

  it('relève l’état d’origine, référence du delta idempotent', () => {
    const child = fakeObject({ usdPath: '/W/A' });
    child.position.set(1, 2, 3);
    child.visible = false;
    const [entry] = indexPrimObjects(asObject3D(fakeObject({}, [child])), ['/W/A']);
    expect(entry!.base).toMatchObject({ position: [1, 2, 3], scale: [1, 1, 1], visible: false });
  });

  it('lit les appartenances multi-jeux (46.R) comme l’ancien format à jeu unique', () => {
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
    expect(a!.variant).toEqual({
      prim: '/K/Plate_1',
      selections: { modelingVariant: 'PlateA', shadingVariant: 'Dirty' },
    });
    expect(b!.variant).toEqual({ prim: '/W/Asset', selections: { modelingVariant: 'lo' } });
  });

  it('replie sur le chemin brut quand aucun prim USD ne correspond', () => {
    const child = fakeObject({ usdPath: '/Inconnu/Truc' });
    const [entry] = indexPrimObjects(asObject3D(fakeObject({}, [child])), ['/W/A']);
    expect(entry!.primPath).toBe('/Inconnu/Truc');
  });
});

describe('applyPlan', () => {
  it('écrit position, rotation, échelle et visibilité sur la scène', () => {
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
  it('remonte du mesh touché jusqu’au prim indexé', () => {
    const mesh = fakeObject({});
    const geo = fakeObject({ usdPath: '/W/Asset/Geo/Geo' }, [mesh]);
    const items = indexPrimObjects(asObject3D(fakeObject({}, [geo])), ['/W/Asset/Geo']);
    // Le chemin glTF a un niveau de plus : l'index a déjà rétabli le prim USD réel.
    expect(items[0]!.primPath).toBe('/W/Asset/Geo');
    expect(makePrimResolver(items)(asObject3D(mesh))).toBe('/W/Asset/Geo');
  });

  it('renvoie null pour un objet hors de la scène USD', () => {
    expect(makePrimResolver([])(asObject3D(fakeObject({})))).toBeNull();
  });
});

describe('transformDeltaFrom', () => {
  it('est l’inverse exact de planOverride : base + delta redonne la pose manipulée', () => {
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
    // Round-trip par planOverride : l'objet revient exactement à la pose du gizmo.
    const override = setPrimEdit(emptyOverride(), '/W/A', { transform: delta });
    const plan = planOverride(
      [{ object: 'o', primPath: '/W/A', base: origin }] as IndexedObject<string>[],
      override,
    )[0]!;
    expect(plan.position).toEqual([3, 1, 0]);
    expect(plan.rotation[1]).toBeCloseTo(1.5);
    expect(plan.scale).toEqual([4, 2, 2]);
  });

  it('pose inchangée → delta identité (donc rien à stocker)', () => {
    const origin = base({ position: [5, 5, 5] });
    const delta = transformDeltaFrom(origin, {
      position: { x: 5, y: 5, z: 5 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
    expect(delta).toEqual({ t: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] });
  });

  it('ne produit pas de NaN sur une base d’échelle nulle', () => {
    const delta = transformDeltaFrom(base({ scale: [0, 1, 1] }), {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 2, y: 2, z: 2 },
    });
    expect(delta.s).toEqual([1, 2, 2]);
  });
});

describe('isDrawn', () => {
  it('suit la visibilité héritée : un enfant d’un objet masqué n’est plus dessiné', () => {
    const child = fakeObject({ usdPath: '/W/A/Mesh' });
    const parent = fakeObject({ usdPath: '/W/A' }, [child]);
    expect(isDrawn(asObject3D(child))).toBe(true);
    parent.visible = false;
    // Three ne touche pas au `visible` des enfants : sans remontée, le halo resterait affiché
    // autour d'un objet devenu invisible.
    expect(child.visible).toBe(true);
    expect(isDrawn(asObject3D(child))).toBe(false);
  });

  it('un objet masqué lui-même n’est pas dessiné', () => {
    const object = fakeObject({});
    object.visible = false;
    expect(isDrawn(asObject3D(object))).toBe(false);
  });
});

describe('renderedPrimPaths', () => {
  it('déduplique les chemins des objets rendus', () => {
    expect(renderedPrimPaths(indexed([['/W/A'], ['/W/A'], ['/W/B']]))).toEqual(['/W/A', '/W/B']);
  });
});
