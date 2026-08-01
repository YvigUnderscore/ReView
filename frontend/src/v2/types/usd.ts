/**
 * Types USD (Phase 45) — description de la scène convertie et provenance de conversion 3D.
 * Module séparé de `api.ts` (budget de lignes), réexporté par lui : une entité = une définition.
 */

/** Purpose USD : ce qui est rendu, le proxy d'affichage rapide, les aides de mise en scène. */
export type UsdPurpose = 'render' | 'proxy' | 'guide';

/** Jeu de variantes exposé par un prim de la scène (ex. `modelingVariant` : hero / lo). */
export interface UsdVariantSet {
  prim: string;
  name: string;
  options: string[];
  selected: string;
}

/** Sélection de variantes : `{ "/World/Asset": { "modelingVariant": "hero" } }`. */
export type UsdVariantSelection = Record<string, Record<string, string>>;

/** Prim de la scène USD (45/46) — brique du scenegraph affiché en review. */
export interface UsdPrim {
  /** Chemin USD absolu, ex. `/World/Asset/Geo`. Identifiant stable d'un prim. */
  path: string;
  name: string;
  /** Type de schéma USD (`Xform`, `Mesh`, `Material`, `Scope`…), vide si non typé. */
  type: string;
  kind: string;
  purpose: string;
  /** Noms des jeux de variantes portés par ce prim (badge dans l'arbre). */
  variantSets: string[];
  active: boolean;
  instanceable: boolean;
}

/** Description de la scène USD relevée à la conversion (fiche technique + recomposition). */
export interface UsdModelInfo {
  /** Couche racine réellement ouverte — utile quand l'archive en contenait plusieurs. */
  rootLayer: string;
  defaultPrim: string | null;
  upAxis: 'Y' | 'Z';
  metersPerUnit: number;
  /** Plage de timeCodes de la scène animée, null si statique. */
  frameRange: [number, number] | null;
  fps: number | null;
  hasAnimation: boolean;
  hasSkeleton: boolean;
  variantSets: UsdVariantSet[];
  purposes: string[];
  /** Ce qui a été demandé… */
  selection: { variants: UsdVariantSelection; purpose: UsdPurpose };
  /** …et si le convertisseur retenu a pu l'appliquer (seul Blender le peut). */
  selectionApplied: boolean;
  /** Références non résolues : textures ou couches absentes de l'archive livrée. */
  missingAssets: string[];
  missingAssetsTotal: number;
  layerCount: number;
  primCount: number;
  /** Scenegraph à plat (46.A) : inclut les prims **non rendus** (variante inactive, purpose filtré). */
  prims: UsdPrim[];
  /** Vrai si la scène dépasse la borne de prims rapportés — l'arbre affiché est partiel. */
  primsTruncated: boolean;
}

/** Option de variante réellement cuite dans le GLB (46.G) — sa bascule est instantanée. */
export interface UsdBakedVariant {
  prim: string;
  set: string;
  option: string;
}

/** Provenance de conversion 3D (39.A) ; le bloc `usd` n'existe que pour les scènes USD (45.C). */
export interface ModelSource {
  sourceFormat: string;
  converter: string;
  native: boolean;
  usd?: UsdModelInfo;
  /** Résumé de conversion Blender — seule la cuisson des variantes intéresse la review (46.P). */
  blender?: {
    variantsBaked?: UsdBakedVariant[];
    variantsSkipped?: UsdBakedVariant[];
  };
}
