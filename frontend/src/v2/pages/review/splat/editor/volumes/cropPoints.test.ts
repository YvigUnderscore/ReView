// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { SdfVolumeData } from '../../../reviewTypes';
import { buildCropChecks, pointCropped } from './cropPoints';

const vol = (over: Partial<SdfVolumeData>): SdfVolumeData => ({
  shape: 'box',
  mode: 'delete',
  position: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
  scale: [1, 1, 1],
  ...over,
});

describe('pointCropped — sémantique des volumes de crop', () => {
  it('« creuser » cache l’intérieur de la boîte (demi-extents = échelle)', () => {
    const checks = buildCropChecks(THREE, [vol({ scale: [2, 1, 1] })]);
    expect(pointCropped(1.5, 0, 0, checks)).toBe(true); // dans la boîte élargie en x
    expect(pointCropped(0, 1.5, 0, checks)).toBe(false); // hors boîte en y
  });

  it('« isoler » cache tout ce qui est hors du volume', () => {
    const checks = buildCropChecks(THREE, [vol({ mode: 'isolate' })]);
    expect(pointCropped(0.5, 0, 0, checks)).toBe(false);
    expect(pointCropped(3, 0, 0, checks)).toBe(true);
  });

  it('ellipsoïde : demi-axes = échelle (position décalée)', () => {
    const checks = buildCropChecks(THREE, [vol({ shape: 'sphere', position: [5, 0, 0], scale: [2, 1, 1] })]);
    expect(pointCropped(6.5, 0, 0, checks)).toBe(true); // à 1,5 du centre sur le demi-axe 2
    expect(pointCropped(5, 0.5, 0, checks)).toBe(true);
    expect(pointCropped(5, 1.5, 0, checks)).toBe(false); // hors demi-axe 1 en y
  });

  it('rotation : la boîte tourne avec son quaternion', () => {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 4);
    const checks = buildCropChecks(THREE, [
      vol({ scale: [2, 0.1, 0.1], quaternion: q.toArray() as [number, number, number, number] }),
    ]);
    // La boîte fine est tournée de 45° dans le plan XY : la diagonale est dedans, l'axe X non.
    expect(pointCropped(1, 1, 0, checks)).toBe(true);
    expect(pointCropped(1.5, 0, 0, checks)).toBe(false);
  });

  it('plusieurs isolats → seule l’intersection reste visible', () => {
    const checks = buildCropChecks(THREE, [
      vol({ mode: 'isolate', position: [0.5, 0, 0] }),
      vol({ mode: 'isolate', position: [-0.5, 0, 0] }),
    ]);
    expect(pointCropped(0, 0, 0, checks)).toBe(false); // dans les deux
    expect(pointCropped(1.2, 0, 0, checks)).toBe(true); // hors du second
  });

  it('aucun volume → rien de caché', () => {
    expect(pointCropped(0, 0, 0, [])).toBe(false);
  });
});
