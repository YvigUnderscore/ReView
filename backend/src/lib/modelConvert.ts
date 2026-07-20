import { extname } from 'node:path';

/**
 * Aiguillage de la conversion 3D → GLB (Phase 39, 39.A). Logique **pure et testable**, extraite
 * du worker : choix du fichier modèle principal d'une archive, choix du convertisseur selon le
 * format source, libellé de format pour la fiche technique. Le worker branche les binaires réels
 * (assimp, convertisseur USD natif type `guc`) sur ces décisions.
 *
 * USD natif : un convertisseur USD→glTF dédié (guc) préserve les matériaux UsdPreviewSurface et
 * les variantes bien mieux qu'assimp (support USD expérimental) ; il est préféré quand il est
 * disponible, avec repli automatique sur assimp (zéro régression).
 */

/** Extensions USD non compressées (le conteneur `.usdz` est traité comme une archive). */
export const USD_EXTENSIONS = ['.usd', '.usdc', '.usda'] as const;

/** Ordre de priorité pour choisir le fichier modèle principal dans une archive (`.zip`/`.usdz`). */
export const MODEL_PRIORITY = ['.gltf', '.glb', '.fbx', '.obj', '.dae', '.stl', '.usdc', '.usda', '.usd'];

/** Convertisseur retenu pour produire le GLB (tracé en `metadata.model.converter`). */
export type ModelConverter = 'copy' | 'gltf' | 'usd' | 'assimp';

/** Vrai si l'extension désigne un fichier USD non compressé (usd/usdc/usda). */
export function isUsdModel(ext: string): boolean {
  return (USD_EXTENSIONS as readonly string[]).includes(ext.toLowerCase());
}

/**
 * Choisit le fichier modèle de plus haute priorité d'une liste (contenu d'archive extrait).
 * Renvoie `null` si aucun format 3D reconnu (textures/annexes ignorées).
 */
export function pickModelFile(paths: string[]): string | null {
  let chosen: string | null = null;
  let bestRank = Infinity;
  for (const p of paths) {
    const rank = MODEL_PRIORITY.indexOf(extname(p).toLowerCase());
    if (rank !== -1 && rank < bestRank) {
      bestRank = rank;
      chosen = p;
    }
  }
  return chosen;
}

/**
 * Décide du convertisseur d'un fichier selon son extension et la disponibilité d'un convertisseur
 * USD natif. `.glb` → copie directe ; `.gltf` → packer JS ; USD → convertisseur natif si présent
 * (préserve matériaux/variantes), sinon assimp ; autres (fbx/obj/dae/stl…) → assimp.
 */
export function chooseConverter(ext: string, opts: { usdConverter: boolean }): ModelConverter {
  const e = ext.toLowerCase();
  if (e === '.glb') return 'copy';
  if (e === '.gltf') return 'gltf';
  if (isUsdModel(e)) return opts.usdConverter ? 'usd' : 'assimp';
  return 'assimp';
}

/** Libellé de format source (fiche technique 39.C) à partir de l'extension d'origine. */
export function sourceFormatLabel(ext: string): string {
  const e = ext.toLowerCase().replace(/^\./, '');
  const map: Record<string, string> = {
    glb: 'glTF (binaire)',
    gltf: 'glTF',
    fbx: 'FBX',
    obj: 'OBJ',
    dae: 'COLLADA',
    stl: 'STL',
    usd: 'USD',
    usdc: 'USD (binaire)',
    usda: 'USD (ASCII)',
    usdz: 'USDZ',
    zip: 'Archive 3D',
  };
  return map[e] ?? e.toUpperCase();
}
