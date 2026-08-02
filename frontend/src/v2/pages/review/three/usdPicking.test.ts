// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import type * as THREE from 'three';
import { CLICK_SLOP_PX, isClickGesture, pickPrim, primPathOf, toNdc } from './usdPicking';

/** Objet Three minimal : seuls `parent`, `visible` et `userData` sont lus ici. */
const node = (userData: Record<string, unknown>, parent: unknown = null, visible = true) =>
  ({ userData, parent, visible }) as never;

/** Faux module Three : `pickPrim` n'utilise que `Raycaster` et `Vector2`. */
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
  it('accepte un pointeur quasi immobile', () => {
    expect(isClickGesture(0, 0)).toBe(true);
    expect(isClickGesture(2, 2)).toBe(true);
  });
  it('rejette un glissement — c’est une orbite, pas une sélection', () => {
    expect(isClickGesture(30, 0)).toBe(false);
    expect(isClickGesture(0, CLICK_SLOP_PX + 1)).toBe(false);
  });
});

describe('toNdc', () => {
  const rect = { left: 100, top: 50, width: 800, height: 400 };

  it('place le centre à l’origine', () => {
    expect(toNdc(500, 250, rect)).toEqual({ x: 0, y: 0 });
  });

  it('inverse l’axe vertical (écran vers NDC)', () => {
    expect(toNdc(100, 50, rect)).toEqual({ x: -1, y: 1 });
    expect(toNdc(900, 450, rect)).toEqual({ x: 1, y: -1 });
  });

  it('reste défini sur un conteneur de taille nulle', () => {
    expect(toNdc(0, 0, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 });
  });
});

describe('pickPrim', () => {
  const ndc = { x: 0, y: 0 };

  it('renvoie le prim de l’objet touché', () => {
    const hit = node({ usdPath: '/World/Asset/Geo/Suzanne' });
    expect(pickPrim(threeWithHits([{ object: hit }]), camera, root, ndc)).toBe('/World/Asset/Geo/Suzanne');
  });

  it('ignore l’option de variante masquée qui occupe la même place', () => {
    // Les deux options sont cuites dans le même GLB : la masquée est touchée en premier par le
    // rayon, mais elle n'est pas affichée — sélectionner un prim invisible n'a aucun sens.
    const hidden = node({ usdPath: '/World/Asset/Geo/Cube' }, null, false);
    const shown = node({ usdPath: '/World/Asset/Geo/Suzanne' });
    const path = pickPrim(threeWithHits([{ object: hidden }, { object: shown }]), camera, root, ndc);
    expect(path).toBe('/World/Asset/Geo/Suzanne');
  });

  it('ignore un objet masqué par l’un de ses parents', () => {
    const parent = node({ usdPath: '/World/Asset' }, null, false);
    const child = node({ usdPath: '/World/Asset/Geo' }, parent);
    expect(pickPrim(threeWithHits([{ object: child }]), camera, root, ndc)).toBeNull();
  });

  it('renvoie null quand le rayon ne touche rien', () => {
    expect(pickPrim(threeWithHits([]), camera, root, ndc)).toBeNull();
  });

  it('délègue la traduction en prim au résolveur fourni', () => {
    // Le viewer y branche son index : le chemin brut du glTF peut ne pas exister côté USD.
    const hit = node({ usdPath: '/World/Asset/Geo/Geo/Suzanne' });
    const resolve = () => '/World/Asset/Geo';
    expect(pickPrim(threeWithHits([{ object: hit }]), camera, root, ndc, resolve)).toBe('/World/Asset/Geo');
  });
});

describe('primPathOf', () => {
  it('remonte au premier ancêtre portant un chemin de prim', () => {
    const asset = node({ usdPath: '/World/Asset' });
    const geo = node({}, asset);
    const mesh = node({}, geo);
    expect(primPathOf(mesh)).toBe('/World/Asset');
  });

  it('privilégie le chemin le plus proche du point touché', () => {
    const asset = node({ usdPath: '/World/Asset' });
    const mesh = node({ usdPath: '/World/Asset/Geo/Suzanne' }, asset);
    expect(primPathOf(mesh)).toBe('/World/Asset/Geo/Suzanne');
  });

  it('renvoie null hors d’une scène USD', () => {
    expect(primPathOf(node({}, node({})))).toBeNull();
    expect(primPathOf(null)).toBeNull();
    // Un `usdPath` qui n'est pas un chemin absolu n'est pas un prim.
    expect(primPathOf(node({ usdPath: 'Suzanne' }))).toBeNull();
  });
});
