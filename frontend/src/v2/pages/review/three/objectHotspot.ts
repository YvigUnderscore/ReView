// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import type { Hotspot3D } from '../reviewTypes';

/**
 * Hotspot de surface pour un modèle Three (Phase 15, V1) : rayon au centre du viewer (NDC 0,0)
 * sur `object` (hiérarchie GLTF). Point stocké en **espace-objet** du groupe (suit la
 * transformation, comme le splat, 10.G-V10). `null` si le rayon ne touche rien.
 */
export function raycastModelCenter(
  three: typeof import('three'),
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
): Hotspot3D | null {
  const raycaster = new three.Raycaster();
  raycaster.setFromCamera(new three.Vector2(0, 0), camera);
  const hits = raycaster.intersectObject(object, true);
  if (hits.length === 0) return null;
  const p = hits[0].point;
  const n = camera.position.clone().sub(p).normalize();
  object.updateMatrixWorld();
  const local = p.clone().applyMatrix4(new three.Matrix4().copy(object.matrixWorld).invert());
  return { position: `${local.x} ${local.y} ${local.z}`, normal: `${n.x} ${n.y} ${n.z}`, space: 'object' };
}

/**
 * Marqueur DOM de hotspot (pastille « 1 ») projeté à l'écran chaque frame — équivalent 3D du
 * marqueur splat, générique sur un `Object3D` (le point espace-objet suit sa matrice monde).
 */
export interface ObjectMarker {
  update(
    hs: { point: THREE.Vector3; objectSpace: boolean } | null,
    camera: THREE.PerspectiveCamera,
    object: THREE.Object3D,
    width: number,
    height: number,
  ): void;
  remove(): void;
}

export function createObjectMarker(three: typeof import('three'), container: HTMLElement): ObjectMarker {
  const el = document.createElement('div');
  el.className =
    'pointer-events-none absolute left-0 top-0 z-[5] flex h-5 w-5 items-center justify-center rounded-full border-2 border-background bg-primary text-[11px] font-semibold text-primary-foreground shadow';
  el.textContent = '1';
  el.style.display = 'none';
  container.appendChild(el);
  const proj = new three.Vector3();
  return {
    update(hs, camera, object, width, height) {
      if (hs && width > 0 && height > 0) {
        proj.copy(hs.point);
        if (hs.objectSpace) proj.applyMatrix4(object.matrixWorld);
        proj.project(camera);
        if (proj.z < 1) {
          const x = (proj.x * 0.5 + 0.5) * width;
          const y = (-proj.y * 0.5 + 0.5) * height;
          el.style.transform = `translate(${x - 10}px, ${y - 10}px)`;
          el.style.display = 'flex';
          return;
        }
      }
      if (el.style.display !== 'none') el.style.display = 'none';
    },
    remove: () => el.remove(),
  };
}
