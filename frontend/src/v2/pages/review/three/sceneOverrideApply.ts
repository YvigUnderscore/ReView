// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import { matchPrimPath } from './usdScenegraph';
import { IDENTITY_TRANSFORM, type PrimTransform, type SceneOverride } from './sceneOverride';

/**
 * Application du « ReView override » sur la scène Three (Phase 46, 46.B).
 *
 * Séparé en deux : `planOverride` **calcule** ce que chaque objet doit devenir (pur, testable
 * sans Three), `applyPlan` se contente d'écrire. L'application est **idempotente** : chaque
 * objet est d'abord ramené à son état d'origine, mémorisé au chargement, puis le delta est
 * posé. Sans cette remise à zéro, désélectionner un commentaire laisserait sa proposition
 * appliquée, et enchaîner deux propositions cumulerait leurs déplacements.
 */

/** État d'origine d'un objet, relevé au chargement du GLB. */
export interface BaseState {
  position: [number, number, number];
  /** Rotation d'origine en euler XYZ (radians) — le delta s'y ajoute. */
  rotation: [number, number, number];
  scale: [number, number, number];
  visible: boolean;
}

/** Appartenance d'un objet aux options de variantes cuites dans le GLB (46.G, multi-jeux 46.R). */
export interface VariantMembership {
  /** Prim porteur des jeux de variantes. */
  prim: string;
  /**
   * Option requise par jeu — l'objet n'est visible que si **toutes** correspondent. Un prim
   * peut porter plusieurs jeux (assiettes : modelingVariant ET shadingVariant) : chaque
   * sous-arbre cuit est composé avec les autres jeux à leur valeur par défaut, et doit
   * disparaître dès que l'un d'eux change.
   */
  selections: Record<string, string>;
}

/** Objet indexé : son chemin de prim résolu et son état d'origine. */
export interface IndexedObject<T> {
  object: T;
  /** Chemin du prim USD, ou le chemin brut du glTF si aucun prim ne correspond. */
  primPath: string;
  base: BaseState;
  /** Renseigné si l'objet appartient à une option de variante — sinon il est toujours visible. */
  variant?: VariantMembership;
}

/** Option active par jeu de variantes : `{ '/World/Asset': { modelingVariant: 'hero' } }`. */
export type VariantSelection = Record<string, Record<string, string>>;

/**
 * Option retenue pour un jeu de variantes : celle de l'override si l'utilisateur en a choisi
 * une, sinon celle qu'avait la scène à la conversion.
 */
export function effectiveVariant(
  override: SceneOverride | null,
  defaults: VariantSelection,
  prim: string,
  set: string,
): string | undefined {
  return override?.prims[prim]?.variants?.[set] ?? defaults[prim]?.[set];
}

/**
 * Vrai si l'objet appartient aux options **retenues** de tous ses jeux de variantes (ou n'en
 * porte aucun). C'est le prédicat unique de visibilité de variante : plan d'application,
 * grisement de l'arbre et cibles de cadrage s'y réfèrent.
 */
export function variantActive<T>(
  entry: IndexedObject<T>,
  override: SceneOverride | null,
  defaults: VariantSelection,
): boolean {
  const membership = entry.variant;
  if (!membership) return true;
  return Object.entries(membership.selections).every(
    ([set, option]) => effectiveVariant(override, defaults, membership.prim, set) === option,
  );
}

/**
 * Vrai si retenir `option` pour le jeu `set` du prim afficherait réellement de la géométrie,
 * compte tenu des options retenues sur les **autres** jeux du même prim.
 *
 * La cuisson importe chaque option composée avec les autres jeux à leur défaut (46.G/46.R) :
 * une combinaison de deux options non-défaut n'existe dans le GLB que si elle a été composée
 * telle quelle — la choisir quand elle ne l'est pas fait tout disparaître (« PlateA puis
 * dirty → l'assiette s'évanouit »). Le menu s'en sert pour griser ces combinaisons (46.U).
 * Si aucun objet indexé ne porte ce jeu (GLB d'avant l'étiquetage), on ne sait pas : ne pas
 * bloquer.
 */
export function variantOptionRenderable<T>(
  indexed: readonly IndexedObject<T>[],
  override: SceneOverride | null,
  defaults: VariantSelection,
  prim: string,
  set: string,
  option: string,
): boolean {
  let known = false;
  for (const entry of indexed) {
    const membership = entry.variant;
    if (!membership || membership.prim !== prim) continue;
    const required = membership.selections[set];
    if (required === undefined) continue;
    known = true;
    if (required !== option) continue;
    const othersMatch = Object.entries(membership.selections).every(
      ([s, o]) => s === set || effectiveVariant(override, defaults, prim, s) === o,
    );
    if (othersMatch) return true;
  }
  return !known;
}

/** Ce qu'il faut écrire sur un objet pour refléter l'override. */
export interface ObjectPlan<T> {
  object: T;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  visible: boolean;
}

/**
 * Calcule l'état cible de chaque objet indexé. Le delta de l'override s'**ajoute** à l'état
 * d'origine : translation et rotation par addition, échelle par multiplication.
 */
export function planOverride<T>(
  indexed: readonly IndexedObject<T>[],
  override: SceneOverride | null,
  /** Options de variantes actives à la conversion — base sur laquelle l'override s'applique. */
  variantDefaults: VariantSelection = {},
): ObjectPlan<T>[] {
  return indexed.map((entry) => {
    const { object, primPath, base } = entry;
    const edit = override?.prims[primPath];
    const delta: PrimTransform = edit?.transform ?? IDENTITY_TRANSFORM;
    // Variante cuite (46.G) : l'objet n'existe dans le GLB que pour des options données, il
    // n'est visible que si elles sont toutes retenues. C'est ce qui rend la bascule instantanée.
    const variantVisible = variantActive(entry, override, variantDefaults);
    return {
      object,
      position: [base.position[0] + delta.t[0], base.position[1] + delta.t[1], base.position[2] + delta.t[2]],
      rotation: [base.rotation[0] + delta.r[0], base.rotation[1] + delta.r[1], base.rotation[2] + delta.r[2]],
      scale: [base.scale[0] * delta.s[0], base.scale[1] * delta.s[1], base.scale[2] * delta.s[2]],
      // `visible: false` sur un objet masque toute sa descendance : l'héritage est gratuit.
      // Une option de variante non retenue l'emporte sur toute demande de visibilité.
      visible: variantVisible && (edit?.visible ?? base.visible),
    };
  });
}

/** Relève l'état d'origine d'un objet Three. */
export function captureBase(object: THREE.Object3D): BaseState {
  return {
    position: [object.position.x, object.position.y, object.position.z],
    rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
    scale: [object.scale.x, object.scale.y, object.scale.z],
    visible: object.visible,
  };
}

/**
 * Indexe les objets du GLB par chemin de prim USD. La correspondance vient de `usdPath`, écrit
 * dans les `extras` glTF par le worker et remonté par three.js dans `userData` ; elle est
 * appariée à l'arbre USD réel (`matchPrimPath`), les deux hiérarchies pouvant différer d'un
 * niveau. Un objet sans `usdPath` (GLB non issu d'USD) est ignoré.
 */
/**
 * Appartenances de variantes d'un nœud glTF. Deux encodages coexistent : `usdVariants`
 * (`set=option;set=option`, multi-jeux — 46.R) et l'ancien couple `usdVariantSet`/
 * `usdVariantOption` (un seul jeu) des médias convertis avant.
 */
function parseMembership(data: {
  usdVariantPrim?: unknown;
  usdVariants?: unknown;
  usdVariantSet?: unknown;
  usdVariantOption?: unknown;
}): VariantMembership | undefined {
  const prim = data.usdVariantPrim;
  if (typeof prim !== 'string' || !prim) return undefined;
  if (typeof data.usdVariants === 'string' && data.usdVariants) {
    const selections: Record<string, string> = {};
    for (const part of data.usdVariants.split(';')) {
      const eq = part.indexOf('=');
      if (eq > 0) selections[part.slice(0, eq)] = part.slice(eq + 1);
    }
    if (Object.keys(selections).length > 0) return { prim, selections };
  }
  if (typeof data.usdVariantSet === 'string' && typeof data.usdVariantOption === 'string')
    return { prim, selections: { [data.usdVariantSet]: data.usdVariantOption } };
  return undefined;
}

export function indexPrimObjects(
  root: THREE.Object3D,
  usdPaths: readonly string[],
): IndexedObject<THREE.Object3D>[] {
  const indexed: IndexedObject<THREE.Object3D>[] = [];
  const paths = [...usdPaths];
  root.traverse((object) => {
    const data = object.userData as Parameters<typeof parseMembership>[0] & { usdPath?: unknown };
    const raw = data?.usdPath;
    if (typeof raw !== 'string' || !raw.startsWith('/')) return;
    const variant = parseMembership(data);
    indexed.push({
      object,
      primPath: matchPrimPath(raw, paths) ?? raw,
      base: captureBase(object),
      ...(variant ? { variant } : {}),
    });
  });
  return indexed;
}

/** Écrit le plan sur la scène. Seule fonction qui mute — le reste est pur. */
export function applyPlan(plans: readonly ObjectPlan<THREE.Object3D>[]): void {
  for (const plan of plans) {
    plan.object.position.set(...plan.position);
    plan.object.rotation.set(...plan.rotation);
    plan.object.scale.set(...plan.scale);
    plan.object.visible = plan.visible;
  }
}

/**
 * Vrai si l'objet est réellement dessiné. Three masque toute la descendance d'un objet invisible
 * **sans toucher** le `visible` des enfants : masquer un prim parent laisse donc ses meshes à
 * `visible: true`. Tout ce qui suit l'affichage (le halo de sélection) doit remonter la
 * hiérarchie, sinon il continue de s'afficher autour d'un objet devenu invisible.
 */
export function isDrawn(object: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) if (!node.visible) return false;
  return true;
}

/**
 * Delta d'override correspondant à la pose **courante** d'un objet par rapport à son état
 * d'origine (46.N — gizmo TRS par prim). Inverse exact de `planOverride` : translation et
 * rotation par différence, échelle par rapport — réappliquer le delta depuis la base redonne
 * la pose manipulée au gizmo près.
 */
export function transformDeltaFrom(
  base: BaseState,
  object: {
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
    scale: { x: number; y: number; z: number };
  },
): PrimTransform {
  // Une base d'échelle nulle est dégénérée (objet aplati) : rapport 1 pour ne pas produire NaN.
  const ratio = (value: number, b: number) => (Math.abs(b) < 1e-12 ? 1 : value / b);
  return {
    t: [
      object.position.x - base.position[0],
      object.position.y - base.position[1],
      object.position.z - base.position[2],
    ],
    r: [
      object.rotation.x - base.rotation[0],
      object.rotation.y - base.rotation[1],
      object.rotation.z - base.rotation[2],
    ],
    s: [
      ratio(object.scale.x, base.scale[0]),
      ratio(object.scale.y, base.scale[1]),
      ratio(object.scale.z, base.scale[2]),
    ],
  };
}

/**
 * Résout un objet touché vers son prim **via l'index**, en remontant la hiérarchie.
 *
 * L'index est la seule table qui fasse autorité : il a déjà apparié le chemin brut du glTF à
 * l'arbre USD (`matchPrimPath`), qui peut collapser un niveau. Lire `usdPath` directement à la
 * sélection produirait un chemin absent de l'index — la sélection ne désignerait alors aucun
 * objet, ni pour le halo ni pour l'arbre.
 */
export function makePrimResolver(
  indexed: readonly IndexedObject<THREE.Object3D>[],
): (object: THREE.Object3D) => string | null {
  const byObject = new Map(indexed.map((entry) => [entry.object, entry.primPath]));
  return (object) => {
    for (let node: THREE.Object3D | null = object; node; node = node.parent) {
      const path = byObject.get(node);
      if (path !== undefined) return path;
    }
    return null;
  };
}

/** Tous les chemins de prims réellement rendus — utile pour isoler ou lister la sélection. */
export function renderedPrimPaths(indexed: readonly IndexedObject<unknown>[]): string[] {
  return [...new Set(indexed.map((i) => i.primPath))];
}
