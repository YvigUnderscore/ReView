// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import type { SplatPaintStroke } from '../../reviewTypes';
import type { SplatSceneHandle } from '../useSplat';

/**
 * Traits du painter 3D (10.G-V9) : (dé)sérialisation depuis le tableau `Comment.annotation`
 * (parties typées, comme les hotspots) et construction du tube 3D — **enfant du SplatMesh**
 * (espace objet → suit la transformation du média, réorientation automatique).
 */

/** Extrait les traits valides d'un tableau d'annotation de commentaire (pur). */
export function decodeStrokes(annotation: unknown): SplatPaintStroke[] {
  if (!Array.isArray(annotation)) return [];
  return annotation.filter(
    (p): p is SplatPaintStroke =>
      !!p &&
      typeof p === 'object' &&
      (p as { type?: string }).type === 'splat-paint' &&
      Array.isArray((p as { points?: unknown }).points) &&
      (p as { points: unknown[] }).points.length >= 6 &&
      (p as { points: unknown[] }).points.length % 3 === 0 &&
      (p as { points: unknown[] }).points.every((v) => Number.isFinite(v)) &&
      typeof (p as { color?: unknown }).color === 'string',
  );
}

/** Rayon du tube (espace objet) : proportionnel à la taille de la scène et à l'épaisseur (pur). */
export function strokeRadius(sceneRadius: number, width: number): number {
  return Math.max(sceneRadius, 0.001) * 0.0025 * Math.max(width, 0.5);
}

/** Construit le tube 3D d'un trait (à ajouter comme enfant du SplatMesh). */
export function buildStrokeMesh(handle: SplatSceneHandle, stroke: SplatPaintStroke): THREE.Mesh {
  const { THREE, mesh } = handle;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i + 2 < stroke.points.length; i += 3)
    pts.push(new THREE.Vector3(stroke.points[i], stroke.points[i + 1], stroke.points[i + 2]));
  let sceneRadius = 1;
  try {
    const sphere = mesh.getBoundingBox(true).getBoundingSphere(new THREE.Sphere());
    if (Number.isFinite(sphere.radius) && sphere.radius > 0) sceneRadius = sphere.radius;
  } catch {
    // bbox indisponible : rayon par défaut
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const geometry = new THREE.TubeGeometry(
    curve,
    Math.min(pts.length * 4, 256),
    strokeRadius(sceneRadius, stroke.width),
    6,
    false,
  );
  const material = new THREE.MeshBasicMaterial({ color: stroke.color });
  const tube = new THREE.Mesh(geometry, material);
  tube.renderOrder = 5; // au-dessus des splats (qui n'écrivent pas la profondeur)
  return tube;
}

/** Libère un tube de trait (géométrie + matériau) et le retire de la scène. */
export function disposeStrokeMesh(tube: THREE.Mesh): void {
  tube.geometry.dispose();
  (tube.material as THREE.Material).dispose();
  tube.removeFromParent();
}
