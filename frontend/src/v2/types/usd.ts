// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * USD types (Phase 45) — description of the converted scene and 3D conversion provenance.
 * Separate module from `api.ts` (line budget), re-exported by it: one entity, one definition.
 */

/** USD purpose: what is rendered, the fast display proxy, the staging guides. */
export type UsdPurpose = 'render' | 'proxy' | 'guide';

/** Variant set exposed by a prim of the scene (e.g. `modelingVariant`: hero / lo). */
export interface UsdVariantSet {
  prim: string;
  name: string;
  options: string[];
  selected: string;
}

/** Variant selection: `{ "/World/Asset": { "modelingVariant": "hero" } }`. */
export type UsdVariantSelection = Record<string, Record<string, string>>;

/** Prim of the USD scene (45/46) — building block of the scenegraph shown in review. */
export interface UsdPrim {
  /** Absolute USD path, e.g. `/World/Asset/Geo`. Stable identifier of a prim. */
  path: string;
  name: string;
  /** USD schema type (`Xform`, `Mesh`, `Material`, `Scope`…), empty if untyped. */
  type: string;
  kind: string;
  purpose: string;
  /** Names of the variant sets carried by this prim (badge in the tree). */
  variantSets: string[];
  active: boolean;
  instanceable: boolean;
}

/** Description of the USD scene recorded at conversion (technical sheet + recomposition). */
export interface UsdModelInfo {
  /** Root layer actually opened — useful when the archive contained several. */
  rootLayer: string;
  defaultPrim: string | null;
  upAxis: 'Y' | 'Z';
  metersPerUnit: number;
  /** Timecode range of the animated scene, null if static. */
  frameRange: [number, number] | null;
  fps: number | null;
  hasAnimation: boolean;
  hasSkeleton: boolean;
  variantSets: UsdVariantSet[];
  purposes: string[];
  /** What was requested… */
  selection: { variants: UsdVariantSelection; purpose: UsdPurpose };
  /** …and whether the chosen converter could apply it (only Blender can). */
  selectionApplied: boolean;
  /** Unresolved references: textures or layers missing from the delivered archive. */
  missingAssets: string[];
  missingAssetsTotal: number;
  layerCount: number;
  primCount: number;
  /** Flat scenegraph (46.A): includes **unrendered** prims (inactive variant, filtered purpose). */
  prims: UsdPrim[];
  /** True if the scene exceeds the reported prim bound — the displayed tree is partial. */
  primsTruncated: boolean;
}

/** Variant option actually baked into the GLB (46.G) — its switch is instant. */
export interface UsdBakedVariant {
  prim: string;
  set: string;
  option: string;
}

/** 3D conversion provenance (39.A); the `usd` block only exists for USD scenes (45.C). */
export interface ModelSource {
  sourceFormat: string;
  converter: string;
  native: boolean;
  usd?: UsdModelInfo;
  /** Blender conversion summary — only the baking of variants matters to review (46.P). */
  blender?: {
    variantsBaked?: UsdBakedVariant[];
    variantsSkipped?: UsdBakedVariant[];
  };
}
