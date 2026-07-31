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
}

/** Provenance de conversion 3D (39.A) ; le bloc `usd` n'existe que pour les scènes USD (45.C). */
export interface ModelSource {
  sourceFormat: string;
  converter: string;
  native: boolean;
  usd?: UsdModelInfo;
}
