import type { SplatSceneHandle } from '../../useSplat';

/** Splats masqués par une opération de suppression (opacités d'origine pour l'annulation). */
export interface HiddenSplats {
  indices: number[];
  opacities: number[];
}

/**
 * Reflet immédiat d'une mutation du packedSplats (11.C) : `needsUpdate` ne fait que ré-uploader
 * la texture de données — l'accumulateur trié de Spark n'est reconstruit que si le générateur
 * du mesh est invalidé (`updateGenerator`). Sans lui, le masquage n'apparaît qu'au prochain
 * mouvement caméra (ou par effet de bord du détachement de la surbrillance).
 */
function commitPackedChange(handle: SplatSceneHandle): void {
  const packed = handle.mesh.packedSplats;
  if (packed) packed.needsUpdate = true;
  handle.mesh.updateGenerator();
}

/**
 * Suppression non-destructive de splats (10.G) : met l'opacité à 0 dans les données paquées
 * en mémoire (`PackedSplats.setSplat`) — le fichier original n'est jamais modifié ; le masque
 * est persisté à part (H5) et ré-appliqué au chargement. Renvoie les opacités d'origine pour
 * l'undo, ou null si rien à masquer (déjà masqués / données indisponibles).
 */
export function hideSplats(handle: SplatSceneHandle, indices: Iterable<number>): HiddenSplats | null {
  const packed = handle.mesh.packedSplats;
  if (!packed) return null;
  const hidden: HiddenSplats = { indices: [], opacities: [] };
  for (const i of indices) {
    const { center, scales, quaternion, opacity, color } = packed.getSplat(i);
    if (opacity <= 0) continue; // déjà masqué
    hidden.indices.push(i);
    hidden.opacities.push(opacity);
    packed.setSplat(i, center, scales, quaternion, 0, color);
  }
  if (hidden.indices.length === 0) return null;
  commitPackedChange(handle);
  return hidden;
}

/** Annulation : restaure les opacités d'origine des splats masqués. */
export function restoreSplats(handle: SplatSceneHandle, hidden: HiddenSplats): void {
  const packed = handle.mesh.packedSplats;
  if (!packed) return;
  hidden.indices.forEach((i, k) => {
    const { center, scales, quaternion, color } = packed.getSplat(i);
    packed.setSplat(i, center, scales, quaternion, hidden.opacities[k]!, color);
  });
  commitPackedChange(handle);
}

/** Rétablissement (redo) : re-masque les splats de l'opération. */
export function rehideSplats(handle: SplatSceneHandle, hidden: HiddenSplats): void {
  const packed = handle.mesh.packedSplats;
  if (!packed) return;
  for (const i of hidden.indices) {
    const { center, scales, quaternion, color } = packed.getSplat(i);
    packed.setSplat(i, center, scales, quaternion, 0, color);
  }
  commitPackedChange(handle);
}
