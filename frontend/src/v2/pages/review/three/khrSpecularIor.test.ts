// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { applyDisplayMode, createDisplayResources } from './displayModes';
import { setObjectOpacity } from './modelCompare';

/**
 * `KHR_materials_specular` + `KHR_materials_ior` : un matériau déclarant
 * `specularColorFactor [0,0,0]` et `ior 1.0` doit charger en `MeshPhysicalMaterial` avec ces
 * valeurs (F0 nul → aucun reflet d'environnement à incidence normale), et les **conserver** à
 * travers les surcouches non destructives du viewer (modes d'affichage, opacité de comparaison).
 * Contre-exemple documenté : une primitive glTF **sans matériau** reçoit le matériau par défaut
 * de la spec (métal blanc, `metalness 1`) — c'est elle qui reflète un HDRI, pas le viewer.
 */

/** GLB binaire minimal : un triangle avec le matériau sous test + un triangle sans matériau. */
function buildGlb(): ArrayBuffer {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const bin = new Uint8Array(positions.buffer.slice(0));
  const json = {
    asset: { version: '2.0' },
    extensionsUsed: ['KHR_materials_specular', 'KHR_materials_ior'],
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [
      { name: 'shaded', mesh: 0 },
      { name: 'unbound', mesh: 1 },
    ],
    meshes: [
      { primitives: [{ attributes: { POSITION: 0 }, material: 0 }] },
      { primitives: [{ attributes: { POSITION: 0 } }] },
    ],
    materials: [
      {
        name: 'matte',
        pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 0.2 },
        extensions: {
          KHR_materials_specular: { specularColorFactor: [0, 0, 0] },
          KHR_materials_ior: { ior: 1.0 },
        },
      },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.byteLength }],
    buffers: [{ byteLength: bin.byteLength }],
  };
  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (jsonBytes.byteLength % 4)) % 4;
  jsonBytes = new Uint8Array([...jsonBytes, ...new Uint8Array(jsonPad).fill(0x20)]);
  const total = 12 + 8 + jsonBytes.byteLength + 8 + bin.byteLength;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); // magic « glTF »
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.byteLength, true);
  view.setUint32(16, 0x4e4f534a, true); // JSON
  out.set(jsonBytes, 20);
  view.setUint32(20 + jsonBytes.byteLength, bin.byteLength, true);
  view.setUint32(24 + jsonBytes.byteLength, 0x004e4942, true); // BIN
  out.set(bin, 28 + jsonBytes.byteLength);
  return out.buffer;
}

const parseGlb = (): Promise<GLTF> =>
  new Promise((resolve, reject) => new GLTFLoader().parse(buildGlb(), '', resolve, reject));

const meshByName = (root: THREE.Object3D, name: string): THREE.Mesh =>
  root.getObjectByName(name) as THREE.Mesh;

describe('KHR_materials_specular / KHR_materials_ior — honorés et préservés', () => {
  it('charge specularColor noir, ior 1 et specularIntensity 1 en MeshPhysicalMaterial', async () => {
    const gltf = await parseGlb();
    const mat = meshByName(gltf.scene, 'shaded').material as THREE.MeshPhysicalMaterial;
    expect(mat.isMeshPhysicalMaterial).toBe(true);
    expect(mat.specularColor.toArray()).toEqual([0, 0, 0]);
    expect(mat.ior).toBe(1);
    expect(mat.specularIntensity).toBe(1);
    expect(mat.metalness).toBe(0);
  });

  it('une primitive sans matériau reçoit le défaut glTF métallique (source de reflets)', async () => {
    const gltf = await parseGlb();
    const mat = meshByName(gltf.scene, 'unbound').material as THREE.MeshStandardMaterial & {
      isMeshPhysicalMaterial?: boolean;
    };
    expect(mat.isMeshPhysicalMaterial ?? false).toBe(false);
    expect(mat.metalness).toBe(1);
    expect(mat.roughness).toBe(1);
  });

  it('les modes d’affichage restaurent le matériau d’origine à l’identique (même instance)', async () => {
    const gltf = await parseGlb();
    const mesh = meshByName(gltf.scene, 'shaded');
    const original = mesh.material as THREE.MeshPhysicalMaterial;
    const res = createDisplayResources(THREE);
    applyDisplayMode(gltf.scene, 'wireframe', res);
    applyDisplayMode(gltf.scene, 'matcap', res);
    applyDisplayMode(gltf.scene, 'shaded', res);
    res.dispose();
    expect(mesh.material).toBe(original);
    expect(original.specularColor.toArray()).toEqual([0, 0, 0]);
    expect(original.ior).toBe(1);
  });

  it('l’opacité de comparaison ne touche ni specularColor ni ior', async () => {
    const gltf = await parseGlb();
    const mat = meshByName(gltf.scene, 'shaded').material as THREE.MeshPhysicalMaterial;
    setObjectOpacity(gltf.scene, 0.5);
    setObjectOpacity(gltf.scene, 1);
    expect(mat.specularColor.toArray()).toEqual([0, 0, 0]);
    expect(mat.ior).toBe(1);
    expect(mat.transparent).toBe(false);
  });
});
