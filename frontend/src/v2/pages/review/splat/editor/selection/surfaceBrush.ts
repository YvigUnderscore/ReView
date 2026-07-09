import type * as THREE from 'three';
import type { SplatSceneHandle } from '../../useSplat';
import { combineSelection, type SelectCombine } from './shapes2d';

/**
 * Brush de surface (10.G-V3) : sélectionne les splats sous le disque du pinceau **et** proches
 * de la profondeur de la surface visée — un raycast au centre du pinceau donne le point de
 * surface, seuls les splats dont la profondeur vue tombe dans une bande autour de ce point sont
 * pris (les splats traversés loin derrière sont ignorés). Repli prévu par le plan : l'API
 * `Readback` de Spark lit par **index de splat**, pas par pixel — pas de depth-picking par
 * pixel exploitable en l'état ; `SplatMesh.raycast` fournit la surface, la bande fait le tri.
 */

/** Demi-épaisseur (espace vue) de la bande de surface pour un rayon de brush donné. */
export function depthBand(
  hitViewZ: number,
  radiusPx: number,
  fovDeg: number,
  viewportHeight: number,
): number {
  // Taille monde d'un pixel à la profondeur touchée × rayon écran : la bande est du même ordre
  // que l'empreinte du pinceau sur la surface (facteur 2 de marge pour les surfaces obliques).
  const worldPerPixel = (2 * hitViewZ * Math.tan((fovDeg * Math.PI) / 360)) / viewportHeight;
  return Math.max(worldPerPixel * radiusPx * 2, 1e-6);
}

/**
 * Pur : indices dont la projection tombe dans le disque écran du pinceau ET dont la profondeur
 * vue (w du clip, pour une caméra perspective) est dans la bande de surface.
 */
export function collectBrushHits(
  e: ArrayLike<number>,
  centers: Float32Array,
  isHidden: (index: number) => boolean,
  viewport: { width: number; height: number },
  brush: { x: number; y: number; radiusPx: number },
  band: { viewZ: number; halfDepth: number },
): number[] {
  const { width, height } = viewport;
  const r2 = brush.radiusPx * brush.radiusPx;
  const zMin = band.viewZ - band.halfDepth;
  const zMax = band.viewZ + band.halfDepth;
  const hits: number[] = [];
  const n = centers.length / 3;
  for (let i = 0; i < n; i++) {
    if (isHidden(i)) continue;
    const x = centers[3 * i];
    const y = centers[3 * i + 1];
    const z = centers[3 * i + 2];
    const w = e[3] * x + e[7] * y + e[11] * z + e[15];
    if (w <= 0) continue; // derrière la caméra
    if (w < zMin || w > zMax) continue; // hors de la bande de surface
    const sx = (((e[0] * x + e[4] * y + e[8] * z + e[12]) / w) * 0.5 + 0.5) * width;
    const sy = (((e[1] * x + e[5] * y + e[9] * z + e[13]) / w) * -0.5 + 0.5) * height;
    const dx = sx - brush.x;
    const dy = sy - brush.y;
    if (dx * dx + dy * dy <= r2) hits.push(i);
  }
  return hits;
}

/**
 * Applique un coup de pinceau : raycast de surface au centre, bande de profondeur, disque
 * écran. Renvoie `null` si le pinceau est dans le vide (aucune surface touchée).
 */
export function selectByBrush(
  handle: SplatSceneHandle,
  centers: Float32Array,
  isHidden: (index: number) => boolean,
  viewport: { width: number; height: number },
  point: { x: number; y: number },
  radiusPx: number,
  prev: ReadonlySet<number>,
  combine: SelectCombine,
): Set<number> | null {
  const { THREE, camera, mesh } = handle;
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(
    new THREE.Vector2((point.x / viewport.width) * 2 - 1, -(point.y / viewport.height) * 2 + 1),
    camera,
  );
  const hits: { distance: number; point: THREE.Vector3; object: THREE.Object3D }[] = [];
  mesh.raycast(raycaster, hits);
  if (hits.length === 0) return null;
  hits.sort((a, b) => a.distance - b.distance);
  // Profondeur vue de la surface = -z en espace caméra (équivaut au w du clip perspective).
  const hitView = hits[0]!.point.clone().applyMatrix4(camera.matrixWorldInverse);
  const viewZ = -hitView.z;
  const halfDepth = depthBand(viewZ, radiusPx, camera.fov, viewport.height);
  mesh.updateWorldMatrix(true, false);
  const m = new THREE.Matrix4()
    .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    .multiply(mesh.matrixWorld);
  const found = collectBrushHits(
    m.elements,
    centers,
    isHidden,
    viewport,
    { x: point.x, y: point.y, radiusPx },
    { viewZ, halfDepth },
  );
  return combineSelection(prev, found, combine);
}
