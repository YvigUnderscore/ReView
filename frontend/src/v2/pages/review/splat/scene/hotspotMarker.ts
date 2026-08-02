// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import type { SplatMesh } from '@sparkjsdev/spark';

/**
 * Marqueur DOM de hotspot (10.G) : pastille « 1 » superposée au canvas, projetée à l'écran à
 * chaque frame par la boucle de rendu (extrait de useSplat, budget 10.F4). N'intercepte pas
 * les événements souris — l'orbite reste libre.
 */
export interface HotspotMarker {
  /** Projette le point (monde ou espace-objet du mesh) en pixels et positionne la pastille. */
  update(
    hs: { point: THREE.Vector3; objectSpace: boolean } | null,
    camera: THREE.PerspectiveCamera,
    mesh: SplatMesh,
    width: number,
    height: number,
  ): void;
  remove(): void;
}

export function createHotspotMarker(three: typeof THREE, container: HTMLElement): HotspotMarker {
  const el = document.createElement('div');
  el.className =
    'pointer-events-none absolute left-0 top-0 z-[5] flex h-5 w-5 items-center justify-center rounded-full border-2 border-background bg-primary text-[11px] font-semibold text-primary-foreground shadow';
  el.textContent = '1';
  el.style.display = 'none';
  container.appendChild(el);
  const proj = new three.Vector3();
  return {
    update(hs, camera, mesh, width, height) {
      if (hs && width > 0 && height > 0) {
        proj.copy(hs.point);
        if (hs.objectSpace) proj.applyMatrix4(mesh.matrixWorld);
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
