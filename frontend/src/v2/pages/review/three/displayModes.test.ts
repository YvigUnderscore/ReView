// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  applyDisplayMode,
  createDisplayResources,
  makeMatcapTexture,
  makeUvCheckerTexture,
  overrideMaterialFor,
} from './displayModes';

function makeModel() {
  const root = new THREE.Group();
  const orig = new THREE.MeshStandardMaterial({ color: 0xff0000 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), orig);
  root.add(mesh);
  return { root, mesh, orig };
}

describe('displayModes — override non destructif des matériaux (39.C)', () => {
  it('remplace le matériau puis le restaure en shaded, sans perdre l’original', () => {
    const res = createDisplayResources(THREE);
    const { root, mesh, orig } = makeModel();

    applyDisplayMode(root, 'normals', res);
    expect(mesh.material).toBe(res.normals);
    expect(mesh.userData.__origMaterial).toBe(orig);

    applyDisplayMode(root, 'wireframe', res);
    expect(mesh.material).toBe(res.wireframe);

    applyDisplayMode(root, 'shaded', res);
    expect(mesh.material).toBe(orig);
    res.dispose();
  });

  it('overrideMaterialFor renvoie null pour shaded, le bon matériau sinon', () => {
    const res = createDisplayResources(THREE);
    expect(overrideMaterialFor('shaded', res)).toBeNull();
    expect(overrideMaterialFor('matcap', res)).toBe(res.matcap);
    expect(overrideMaterialFor('uv', res)).toBe(res.uv);
    res.dispose();
  });

  it('sauvegarde l’original une seule fois (ré-application idempotente)', () => {
    const res = createDisplayResources(THREE);
    const { root, mesh, orig } = makeModel();
    applyDisplayMode(root, 'uv', res);
    applyDisplayMode(root, 'matcap', res);
    expect(mesh.userData.__origMaterial).toBe(orig);
    res.dispose();
  });

  it('makeUvCheckerTexture / makeMatcapTexture produisent des DataTexture RGBA sRGB', () => {
    const uv = makeUvCheckerTexture(THREE, 64, 8);
    expect(uv.image.width).toBe(64);
    expect(uv.image.data!.length).toBe(64 * 64 * 4);
    expect(uv.colorSpace).toBe(THREE.SRGBColorSpace);
    const matcap = makeMatcapTexture(THREE, 64);
    expect(matcap.image.height).toBe(64);
    // Le centre (sphère éclairée) est plus clair que le coin (fond).
    const data = matcap.image.data!;
    const center = data[(32 * 64 + 32) * 4];
    const corner = data[0];
    expect(center).toBeGreaterThan(corner);
  });
});
