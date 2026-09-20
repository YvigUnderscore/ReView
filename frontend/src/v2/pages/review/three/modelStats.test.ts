// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { collectModelStats } from './modelStats';

describe('collectModelStats — fiche technique du modèle (39.C)', () => {
  it('compte triangles/sommets/meshes et déduplique les matériaux', () => {
    const root = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ name: 'Body' });
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), mat)); // 12 tris, 24 sommets
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), mat)); // même matériau partagé

    const stats = collectModelStats(root);
    expect(stats.meshes).toBe(2);
    expect(stats.triangles).toBe(24);
    expect(stats.materials).toHaveLength(1);
    expect(stats.materials[0]).toEqual({ name: 'Body', type: 'MeshStandardMaterial' });
  });

  it('liste les jeux d’UV et les textures par canal (dédupliquées)', () => {
    const root = new THREE.Group();
    const tex = new THREE.DataTexture(new Uint8Array([1, 2, 3, 4]), 1, 1);
    tex.name = 'albedo';
    const mat = new THREE.MeshStandardMaterial({ name: 'M', map: tex });
    const geo = new THREE.BoxGeometry();
    root.add(new THREE.Mesh(geo, mat));

    const stats = collectModelStats(root);
    expect(stats.uvSets).toContain('uv');
    expect(stats.textures).toHaveLength(1);
    expect(stats.textures[0].slot).toBe('map');
    expect(stats.textures[0].name).toBe('albedo');
    expect(stats.textures[0].width).toBe(1);
  });

  it('relève aussi les textures des extensions KHR_materials_*', () => {
    // Le chargeur glTF de Three résout ces extensions en `MeshPhysicalMaterial` : le viewer
    // les RENDAIT déjà, mais la fiche technique ne balayait que les neuf slots de base — un
    // shader de verre ou de vernis n'affichait donc aucune texture.
    const root = new THREE.Group();
    const mat = new THREE.MeshPhysicalMaterial({ name: 'Glass' });
    mat.clearcoatMap = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    mat.transmissionMap = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    mat.thicknessMap = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    mat.sheenColorMap = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    mat.iridescenceMap = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    mat.anisotropyMap = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), mat));

    const slots = collectModelStats(root).textures.map((tex) => tex.slot);
    expect(slots).toEqual(
      expect.arrayContaining([
        'clearcoatMap',
        'transmissionMap',
        'thicknessMap',
        'sheenColorMap',
        'iridescenceMap',
        'anisotropyMap',
      ]),
    );
  });

  it('modèle vide : compteurs à zéro, listes vides', () => {
    const stats = collectModelStats(new THREE.Group());
    expect(stats).toMatchObject({ meshes: 0, triangles: 0, vertices: 0, materials: [], textures: [] });
  });
});
