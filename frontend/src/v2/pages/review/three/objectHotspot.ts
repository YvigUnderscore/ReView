// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import type { Hotspot3D } from '../reviewTypes';
import { isDrawn } from './sceneOverrideApply';

/**
 * Point de surface visé par un rayon caméra (NDC). Comme pour la sélection de prim, les objets
 * invisibles sont écartés : les options d'une variante USD sont toutes cuites au même endroit
 * dans le GLB, et sans ce filtre le rayon accroche celle que personne ne voit.
 */
export function raycastSurface(
  three: typeof import('three'),
  camera: THREE.Camera,
  object: THREE.Object3D,
  ndc: { x: number; y: number },
): THREE.Intersection | null {
  const raycaster = new three.Raycaster();
  raycaster.setFromCamera(new three.Vector2(ndc.x, ndc.y), camera);
  return raycaster.intersectObject(object, true).find((h) => isDrawn(h.object)) ?? null;
}

/**
 * Hotspot de surface pour un modèle Three, posé **là où l'on clique** (NDC du pointeur). Point
 * stocké en **espace-objet** du groupe (suit la transformation, comme le splat, 10.G-V10).
 * `null` si le rayon ne touche rien.
 *
 * Historique : le hotspot ne pouvait se poser qu'au centre de l'écran, ce qui obligeait à
 * recadrer la caméra pour désigner un défaut — alors que le picking au clic existait déjà
 * juste à côté (`usdPicking`). Le centre reste disponible (`raycastModelCenter`) pour la
 * palette de commandes et les raccourcis, où il n'y a pas de pointeur.
 */
export function raycastModelPoint(
  three: typeof import('three'),
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  ndc: { x: number; y: number },
): Hotspot3D | null {
  const hit = raycastSurface(three, camera, object, ndc);
  if (!hit) return null;
  const p = hit.point;
  const n = camera.position.clone().sub(p).normalize();
  object.updateMatrixWorld();
  const local = p.clone().applyMatrix4(new three.Matrix4().copy(object.matrixWorld).invert());
  return { position: `${local.x} ${local.y} ${local.z}`, normal: `${n.x} ${n.y} ${n.z}`, space: 'object' };
}

/** Hotspot au centre du viewer (NDC 0,0) — repli sans pointeur (palette, raccourci). */
export function raycastModelCenter(
  three: typeof import('three'),
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
): Hotspot3D | null {
  return raycastModelPoint(three, camera, object, { x: 0, y: 0 });
}

/** Point d'ancrage d'un marqueur : position (espace objet ou monde) et son numéro d'affichage. */
export interface MarkerPoint {
  point: THREE.Vector3;
  objectSpace: boolean;
}

/** Point sérialisé (`"x y z"`) → point de marqueur ; `null` si la chaîne est inexploitable. */
export function toMarkerPoint(three: typeof import('three'), hs: Hotspot3D): MarkerPoint | null {
  const [x, y, z] = hs.position.split(/\s+/).map((v) => parseFloat(v));
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return { point: new three.Vector3(x, y, z), objectSpace: hs.space === 'object' };
}

/**
 * Marqueurs DOM des hotspots (pastilles numérotées) projetés à l'écran chaque frame —
 * équivalent 3D du marqueur splat, générique sur un `Object3D` (les points en espace-objet
 * suivent sa matrice monde). Le numéro n'est plus figé à « 1 » : un commentaire peut désigner
 * plusieurs défauts, et chaque pastille porte son rang.
 */
export interface ObjectMarker {
  update(
    points: MarkerPoint[] | MarkerPoint | null,
    camera: THREE.PerspectiveCamera,
    object: THREE.Object3D,
    width: number,
    height: number,
  ): void;
  remove(): void;
}

const MARKER_CLASS =
  'pointer-events-none absolute left-0 top-0 z-[5] flex h-5 w-5 items-center justify-center rounded-full border-2 border-background bg-primary text-xs font-semibold text-primary-foreground shadow';

export function createObjectMarker(three: typeof import('three'), container: HTMLElement): ObjectMarker {
  const els: HTMLDivElement[] = [];
  const proj = new three.Vector3();

  /** Pastille de rang `i`, créée à la demande (un seul point = un seul nœud dans le DOM). */
  const elementAt = (i: number): HTMLDivElement => {
    let el = els[i];
    if (!el) {
      el = document.createElement('div');
      el.className = MARKER_CLASS;
      el.textContent = String(i + 1);
      el.style.display = 'none';
      container.appendChild(el);
      els[i] = el;
    }
    return el;
  };

  return {
    update(points, camera, object, width, height) {
      const list = points == null ? [] : Array.isArray(points) ? points : [points];
      for (let i = 0; i < Math.max(list.length, els.length); i++) {
        const el = els[i] ?? (i < list.length ? elementAt(i) : null);
        if (!el) continue;
        const hs = list[i];
        if (hs && width > 0 && height > 0) {
          proj.copy(hs.point);
          if (hs.objectSpace) proj.applyMatrix4(object.matrixWorld);
          proj.project(camera);
          if (proj.z < 1) {
            const x = (proj.x * 0.5 + 0.5) * width;
            const y = (-proj.y * 0.5 + 0.5) * height;
            el.style.transform = `translate(${x - 10}px, ${y - 10}px)`;
            el.style.display = 'flex';
            continue;
          }
        }
        if (el.style.display !== 'none') el.style.display = 'none';
      }
    },
    remove: () => els.forEach((el) => el.remove()),
  };
}
