// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Line2 } from 'three/addons/lines/Line2.js';
import type { SplatPaintStroke } from '../../reviewTypes';
import type { LineModules } from './lineModules';
import { attachStrokeFrame } from './strokeFrame';
import type { PaintSceneHandle } from './surfaceRay';
import { strokeCenter, type Vec3 } from './surfaceTrace';

/**
 * Traits de la brosse de surface 3D : (dé)sérialisation depuis le tableau `Comment.annotation`
 * (parties typées, comme les hotspots) et construction de la ligne 3D — **enfant de l'objet
 * peint** (espace objet → suit la transformation du média), le nuage côté splat, le groupe racine
 * côté modèle.
 *
 * Le type de part reste `splat-paint` bien que la brosse serve les deux types spatiaux : c'est un
 * discriminant **écrit dans les commentaires existants**, et le renommer rendrait muets tous les
 * traits déjà envoyés. Le schéma Zod du serveur (`lib/commentPayload`) ne regarde d'ailleurs pas
 * le type de média.
 *
 * L'épaisseur est en **pixels d'écran** : `LineMaterial` la tient constante quel que soit le
 * zoom (cf. `lineModules`), là où l'ancien tube en unités monde grossissait en approchant et
 * disparaissait en reculant. Les traits d'avant ce changement gardent leur nombre — il valait
 * 1 à 5 « relatif », il vaut 1 à 5 pixels : à peu près le même trait à l'écran.
 */

/**
 * Bornes de l'épaisseur, en pixels d'écran — **la même unité que l'anneau du curseur** de
 * l'overlay et que le champ de la barre d'options : `linewidth` est une largeur en pixels quand
 * `worldUnits` est faux, et `strokeFrame` donne au matériau la résolution en pixels CSS. Ce que
 * l'on règle est donc exactement ce que l'on voit sous le pointeur.
 *
 * Le plafond est passé de 16 à 32 px (lot 13) : entourer un objet entier dans un plan large
 * demandait un trait plus épais que ce que la brosse acceptait.
 */
export const MIN_STROKE_PX = 1;
export const MAX_STROKE_PX = 32;
export const DEFAULT_STROKE_PX = 3;

/** Épaisseur ramenée dans les bornes — un trait relu ne peut pas être nul ni démesuré. */
export function clampStrokeWidth(width: unknown): number {
  const value = typeof width === 'number' && Number.isFinite(width) ? width : DEFAULT_STROKE_PX;
  return Math.min(MAX_STROKE_PX, Math.max(MIN_STROKE_PX, value));
}

/** Triplet fini, ou `null` : la normale est facultative (traits d'avant l'occlusion). */
function readVec3(value: unknown): Vec3 | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const [x, y, z] = value;
  if (![x, y, z].every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  return [x as number, y as number, z as number];
}

/**
 * Extrait les traits valides d'un tableau d'annotation de commentaire (pur). Les traits sont
 * **normalisés** au passage : épaisseur bornée, normale absente si elle est illisible — le
 * rendu n'a plus à se défendre de ce qui a été écrit par une version antérieure.
 */
export function decodeStrokes(annotation: unknown): SplatPaintStroke[] {
  if (!Array.isArray(annotation)) return [];
  const strokes: SplatPaintStroke[] = [];
  for (const part of annotation) {
    if (!part || typeof part !== 'object') continue;
    const candidate = part as { type?: unknown; points?: unknown; color?: unknown; normal?: unknown };
    if (candidate.type !== 'splat-paint' || typeof candidate.color !== 'string') continue;
    const points = candidate.points;
    if (
      !Array.isArray(points) ||
      points.length < 6 ||
      points.length % 3 !== 0 ||
      !points.every((v) => typeof v === 'number' && Number.isFinite(v))
    )
      continue;
    const normal = readVec3(candidate.normal);
    strokes.push({
      type: 'splat-paint',
      points: points as number[],
      color: candidate.color,
      width: clampStrokeWidth((candidate as { width?: unknown }).width),
      ...(normal ? { normal } : {}),
    });
  }
  return strokes;
}

/**
 * Construit la ligne 3D d'un trait (à ajouter comme enfant de l'objet peint).
 *
 * `frustumCulled` est laissé à faux : la sphère englobante d'une `LineGeometry` ignore
 * l'épaisseur écran, et un trait rasant le bord du cadre disparaissait d'un coup.
 *
 * Deux réglages tiennent le trait sur une **vraie surface**, ce que le nuage n'imposait pas :
 *
 *  - `polygonOffset` rapproche le trait de l'œil dans le tampon de profondeur. Un trait peint
 *    exactement sur un maillage y est coplanaire : sans ce décalage, il s'y bat en z et sort en
 *    pointillés clignotants. Le nuage n'écrivant pas la profondeur, le réglage y est sans effet.
 *  - `raycast` devient inerte : les traits sont enfants de l'objet peint, et le rayon de la
 *    brosse descend la hiérarchie sur un modèle. Sans cela, peindre par-dessus un trait existant
 *    accrocherait le trait au lieu de la surface — et la gomme, qui mesure à l'écran, n'a pas
 *    besoin d'être touchée par un rayon.
 */
export function buildStrokeLine(
  handle: PaintSceneHandle,
  lines: LineModules,
  stroke: SplatPaintStroke,
): Line2 {
  const geometry = new lines.LineGeometry();
  geometry.setPositions(stroke.points);
  const material = new lines.LineMaterial({
    color: stroke.color,
    linewidth: clampStrokeWidth(stroke.width),
    // Épaisseur en pixels d'écran ; la résolution est donnée à chaque image par `strokeFrame`.
    worldUnits: false,
    // L'occlusion approchée module l'opacité : sans transparence, elle n'aurait aucun effet.
    transparent: true,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const line = new lines.Line2(geometry, material);
  line.renderOrder = 5; // au-dessus des splats (qui n'écrivent pas la profondeur)
  line.frustumCulled = false;
  line.raycast = () => {};
  attachStrokeFrame(line, handle, stroke.normal ?? null, strokeCenter(stroke.points));
  return line;
}

/** Libère une ligne de trait (géométrie + matériau) et la retire de la scène. */
export function disposeStrokeLine(line: Line2): void {
  line.onBeforeRender = () => {};
  line.geometry.dispose();
  line.material.dispose();
  line.removeFromParent();
}
