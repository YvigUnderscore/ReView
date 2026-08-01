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

/** Appartenance d'un objet à une option de variante cuite dans le GLB (46.G). */
export interface VariantMembership {
  /** Prim porteur du jeu de variantes. */
  prim: string;
  set: string;
  option: string;
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
  return indexed.map(({ object, primPath, base, variant }) => {
    const edit = override?.prims[primPath];
    const delta: PrimTransform = edit?.transform ?? IDENTITY_TRANSFORM;
    // Variante cuite (46.G) : l'objet n'existe dans le GLB que pour une option donnée, il
    // n'est visible que si c'est celle retenue. C'est ce qui rend la bascule instantanée.
    const variantVisible =
      !variant || effectiveVariant(override, variantDefaults, variant.prim, variant.set) === variant.option;
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
export function indexPrimObjects(
  root: THREE.Object3D,
  usdPaths: readonly string[],
): IndexedObject<THREE.Object3D>[] {
  const indexed: IndexedObject<THREE.Object3D>[] = [];
  const paths = [...usdPaths];
  root.traverse((object) => {
    const data = object.userData as
      | { usdPath?: unknown; usdVariantPrim?: unknown; usdVariantSet?: unknown; usdVariantOption?: unknown }
      | undefined;
    const raw = data?.usdPath;
    if (typeof raw !== 'string' || !raw.startsWith('/')) return;
    const variant =
      typeof data?.usdVariantPrim === 'string' &&
      typeof data.usdVariantSet === 'string' &&
      typeof data.usdVariantOption === 'string'
        ? { prim: data.usdVariantPrim, set: data.usdVariantSet, option: data.usdVariantOption }
        : undefined;
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

/** Tous les chemins de prims réellement rendus — utile pour isoler ou lister la sélection. */
export function renderedPrimPaths(indexed: readonly IndexedObject<unknown>[]): string[] {
  return [...new Set(indexed.map((i) => i.primPath))];
}
