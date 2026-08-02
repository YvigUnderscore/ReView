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

  it('modèle vide : compteurs à zéro, listes vides', () => {
    const stats = collectModelStats(new THREE.Group());
    expect(stats).toMatchObject({ meshes: 0, triangles: 0, vertices: 0, materials: [], textures: [] });
  });
});
