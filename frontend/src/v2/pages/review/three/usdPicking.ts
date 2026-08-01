import type * as THREE from 'three';

/**
 * Sélection d'un prim au clic dans le viewer 3D (Phase 46, 46.C).
 *
 * Le clic gauche du viewer sert aussi à l'orbite : on ne sélectionne donc que si le pointeur
 * n'a **pas bougé** entre l'appui et le relâchement (au-delà de quelques pixels, c'est une
 * navigation). Sans ce garde-fou, toute rotation de caméra changerait la sélection.
 */

/** Distance en pixels au-delà de laquelle le geste est une navigation, pas un clic. */
export const CLICK_SLOP_PX = 4;

/** Vrai si le déplacement du pointeur reste dans la tolérance d'un clic. */
export function isClickGesture(dx: number, dy: number, slop = CLICK_SLOP_PX): boolean {
  return Math.hypot(dx, dy) <= slop;
}

/** Coordonnées NDC (−1..1) d'un point écran dans un élément donné. */
export function toNdc(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  const x = rect.width > 0 ? ((clientX - rect.left) / rect.width) * 2 - 1 : 0;
  const y = rect.height > 0 ? -(((clientY - rect.top) / rect.height) * 2 - 1) : 0;
  // `|| 0` normalise le `-0` que produit l'inversion verticale au centre exact.
  return { x: x || 0, y: y || 0 };
}

/**
 * Remonte la hiérarchie jusqu'au premier objet portant un `usdPath` : un clic touche un mesh,
 * mais c'est le prim qui porte l'identité manipulable.
 */
export function primPathOf(object: THREE.Object3D | null): string | null {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    const path = (node.userData as { usdPath?: unknown } | undefined)?.usdPath;
    if (typeof path === 'string' && path.startsWith('/')) return path;
  }
  return null;
}

/** Prim touché par un rayon lancé depuis la caméra, ou `null`. */
export function pickPrim(
  three: typeof import('three'),
  camera: THREE.Camera,
  root: THREE.Object3D,
  ndc: { x: number; y: number },
): string | null {
  const raycaster = new three.Raycaster();
  raycaster.setFromCamera(new three.Vector2(ndc.x, ndc.y), camera);
  // `intersectObject` ignore déjà les objets invisibles : un prim masqué par l'override ou
  // par une variante inactive n'est pas sélectionnable, ce qui est le comportement attendu.
  const hits = raycaster.intersectObject(root, true);
  return hits.length > 0 ? primPathOf(hits[0]!.object) : null;
}
