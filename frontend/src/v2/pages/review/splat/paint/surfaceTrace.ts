// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Géométrie de la brosse de surface 3D — fonctions **pures**, sans Three : c'est ici que se
 * décide ce qui fait un trait, et c'est ici que ça se teste.
 *
 * Deux problèmes y sont traités :
 *
 *  1. **La corde droite.** Un geste qui traverse un trou du nuage (ou saute d'un objet au fond
 *     de la scène) touchait deux surfaces très éloignées, et le trait les reliait par un
 *     segment flottant dans le vide. `breaksRun` compare le déplacement réel en espace monde au
 *     déplacement *attendu* pour le pas écran parcouru à cette profondeur : au-delà d'un
 *     facteur, les deux échantillons ne sont plus sur la même surface et le trait est coupé.
 *  2. **La face arrière.** `runNormal` moyenne les directions point → caméra du geste : peinte
 *     sur la face qu'on regarde, elle sert d'approximation de normale pour estomper le trait
 *     quand on tourne autour du nuage (cf. `strokeFrame`).
 *
 * `pickStroke` sert la gomme : le trait le plus proche du clic, mesuré **à l'écran** sur les
 * polylignes projetées — aucun raycast, donc aucune dépendance au rendu.
 */

export type Vec3 = [number, number, number];

/** Un échantillon du geste : le point de surface touché et ce qu'il faut pour le juger. */
export interface SurfaceSample {
  /** Point touché en espace monde — les distances se comparent là. */
  world: Vec3;
  /** Le même point en espace objet du SplatMesh : c'est ce qui est stocké dans le trait. */
  object: Vec3;
  /** Distance caméra → point au moment du geste. */
  depth: number;
  /** Pas écran (px) depuis l'échantillon précédent du geste (0 pour le premier). */
  screenStep: number;
  /** Direction point → caméra en espace objet, normalisée. */
  toCamera: Vec3;
}

/**
 * Au-delà de ce multiple du déplacement attendu, deux échantillons voisins ne sont plus sur la
 * même surface. Large à dessein : une surface vue en biais avance vite en profondeur sans qu'il
 * s'agisse d'un trou, et couper un trait à tort est plus visible que de laisser une corde courte.
 */
export const HOLE_JUMP_FACTOR = 6;

/** Tolérance de la gomme, en pixels : distance maximale du clic au trait. */
export const ERASE_TOLERANCE_PX = 14;

/** Taille, en unités monde, d'un pixel écran à cette profondeur (caméra perspective). */
export function worldPerPixel(depth: number, fovDeg: number, viewportHeight: number): number {
  const half = Math.tan((Math.max(fovDeg, 1) * Math.PI) / 360);
  return (2 * half * Math.max(depth, 0)) / Math.max(viewportHeight, 1);
}

/** Distance euclidienne entre deux points. */
export function distance3(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Vrai si le trait doit être coupé entre ces deux échantillons : le déplacement monde dépasse
 * `factor` fois celui qu'un pas écran de cette longueur produit à cette profondeur.
 */
export function breaksRun(
  prev: SurfaceSample,
  next: SurfaceSample,
  view: { fovDeg: number; height: number },
  factor = HOLE_JUMP_FACTOR,
): boolean {
  const moved = distance3(prev.world, next.world);
  // La plus petite des deux profondeurs : c'est celle qui donne le pas le plus court, donc le
  // seuil le plus sévère — un saut vers le fond de la scène ne doit pas s'auto-justifier.
  const scale = worldPerPixel(Math.min(prev.depth, next.depth), view.fovDeg, view.height);
  const expected = Math.max(next.screenStep, 1) * scale;
  return moved > expected * factor;
}

/** Normale approchée d'un trait : moyenne normalisée des directions point → caméra. */
export function runNormal(samples: readonly SurfaceSample[]): Vec3 | null {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const s of samples) {
    x += s.toCamera[0];
    y += s.toCamera[1];
    z += s.toCamera[2];
  }
  const length = Math.hypot(x, y, z);
  if (!Number.isFinite(length) || length < 1e-9) return null;
  return [x / length, y / length, z / length];
}

/** Coordonnées objet des échantillons, aplaties pour le trait stocké. */
export function flattenObject(samples: readonly SurfaceSample[]): number[] {
  const points: number[] = [];
  for (const s of samples) points.push(s.object[0], s.object[1], s.object[2]);
  return points;
}

/** Centre d'un trait (moyenne de ses points) — origine de la mesure d'orientation. */
export function strokeCenter(points: readonly number[]): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  const n = Math.floor(points.length / 3);
  if (n === 0) return [0, 0, 0];
  for (let i = 0; i < n; i++) {
    x += points[3 * i];
    y += points[3 * i + 1];
    z += points[3 * i + 2];
  }
  return [x / n, y / n, z / n];
}

/** Distance d'un point au segment [a, b], en 2D. */
export function distanceToSegment(
  p: readonly [number, number],
  a: readonly [number, number],
  b: readonly [number, number],
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Projection d'un point objet en pixels de la vue, ou `null` s'il est derrière la caméra. */
export type Projector = (x: number, y: number, z: number) => [number, number] | null;

/**
 * Index du trait le plus proche du point écran, ou `null` si aucun n'entre dans la tolérance.
 * Les traits sont comparés segment par segment : un trait long ne gagne pas parce qu'il est long.
 */
export function pickStroke(
  strokes: readonly { points: number[] }[],
  at: readonly [number, number],
  project: Projector,
  tolerancePx = ERASE_TOLERANCE_PX,
): number | null {
  let bestIndex: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < strokes.length; index++) {
    const { points } = strokes[index];
    let previous: [number, number] | null = null;
    for (let i = 0; i + 2 < points.length; i += 3) {
      const screen = project(points[i], points[i + 1], points[i + 2]);
      if (screen) {
        const d = previous
          ? distanceToSegment(at, previous, screen)
          : Math.hypot(at[0] - screen[0], at[1] - screen[1]);
        if (d <= tolerancePx && d < bestDistance) {
          bestIndex = index;
          bestDistance = d;
        }
      }
      previous = screen;
    }
  }
  return bestIndex;
}
