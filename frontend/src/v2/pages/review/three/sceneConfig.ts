import type * as THREE from 'three';

/**
 * Helpers purs du socle Three commun (Phase 15, V0) — testables sans contexte WebGL.
 * `createModelScene` (impur, instancie le renderer) s'appuie dessus.
 */

/** Marge de sécurité du cadrage (l'objet occupe ~1/margin du champ le plus contraint). */
export const FRAME_MARGIN = 1.25;

/**
 * Gestion de couleur du renderer (V0/V4) : ColorManagement activé, sortie sRGB, tone mapping
 * ACES Filmic (rendu proche d'un moteur 3D ; ACEScg → sRGB géré à l'affichage). Séparé de
 * `createModelScene` pour être vérifié unitairement (fake renderer + constantes THREE).
 */
export function configureRenderer(three: typeof import('three'), renderer: THREE.WebGLRenderer): void {
  three.ColorManagement.enabled = true;
  renderer.outputColorSpace = three.SRGBColorSpace;
  renderer.toneMapping = three.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
}

/**
 * Redimensionne renderer + caméra sur (w, h). No-op si une dimension est nulle (conteneur non
 * encore mesuré). Renvoie `true` si appliqué.
 */
export function resizeRendererCamera(
  renderer: Pick<THREE.WebGLRenderer, 'setSize'>,
  camera: THREE.PerspectiveCamera,
  w: number,
  h: number,
): boolean {
  if (w <= 0 || h <= 0) return false;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  return true;
}

/**
 * Distance caméra pour cadrer une sphère de rayon `radius` dans le plus contraint des deux
 * champs (vertical/horizontal) — cohérent avec l'auto-cadrage splat (`frameCamera`). Renvoie 0
 * si les entrées sont dégénérées.
 */
export function fitDistance(radius: number, vFovDeg: number, aspect: number): number {
  if (!Number.isFinite(radius) || radius <= 0 || vFovDeg <= 0) return 0;
  const vFov = (vFovDeg * Math.PI) / 180;
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * a);
  return (radius / Math.sin(Math.min(vFov, hFov) / 2)) * FRAME_MARGIN;
}
