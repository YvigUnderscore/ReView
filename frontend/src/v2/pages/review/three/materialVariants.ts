import type * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Variantes de matériaux glTF `KHR_materials_variants` (Phase 40, 40.C) : bascule des matériaux
 * d'un mesh selon la variante sélectionnée (ex. plusieurs coloris d'un même asset). Le `GLTFLoader`
 * de Three.js expose les noms dans `gltf.userData.variants` et, par mesh, le mapping
 * variante→matériau dans `mesh.userData.gltfExtensions.KHR_materials_variants.mappings`.
 * Le matériau réel est chargé paresseusement via `gltf.parser.getDependency('material', i)`.
 */

/** Mapping d'un mesh : quel index de matériau utiliser pour quelles variantes. */
export interface VariantMapping {
  material: number;
  variants: number[];
}

interface VariantParser {
  getDependency(type: 'material', index: number): Promise<THREE.Material>;
  assignFinalMaterial?: (mesh: THREE.Mesh) => void;
}

/** Noms des variantes déclarées par le fichier (`[]` si l'extension est absente). */
export function readVariants(gltf: GLTF): string[] {
  const v = (gltf.userData as { variants?: unknown }).variants;
  return Array.isArray(v) ? v.map((n) => String(n)) : [];
}

/**
 * Choisit l'index de matériau à appliquer pour une variante (pur/testable). `variantIndex < 0`
 * (défaut) ou aucun mapping correspondant → `null` (restaurer le matériau d'origine).
 */
export function pickVariantMaterialIndex(mappings: VariantMapping[], variantIndex: number): number | null {
  if (variantIndex < 0) return null;
  const mapping = mappings.find((m) => m.variants.includes(variantIndex));
  return mapping ? mapping.material : null;
}

interface VariantMeshUserData {
  gltfExtensions?: { KHR_materials_variants?: { mappings?: VariantMapping[] } };
  originalMaterial?: THREE.Material | THREE.Material[];
}

/**
 * Applique la variante `variantIndex` à tout le sous-arbre (`-1` = matériaux d'origine). Mémorise
 * le matériau d'origine de chaque mesh au premier passage (restauration non destructive). Async :
 * les matériaux sont chargés à la demande par le parser glTF.
 */
export async function applyVariant(gltf: GLTF, root: THREE.Object3D, variantIndex: number): Promise<void> {
  const parser = gltf.parser as unknown as VariantParser;
  const tasks: Promise<void>[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh & { isMesh?: boolean };
    const ud = mesh.userData as VariantMeshUserData;
    const mappings = ud.gltfExtensions?.KHR_materials_variants?.mappings;
    if (!mesh.isMesh || !mappings) return;
    if (!ud.originalMaterial) ud.originalMaterial = mesh.material;
    const index = pickVariantMaterialIndex(mappings, variantIndex);
    if (index == null) {
      if (ud.originalMaterial) mesh.material = ud.originalMaterial;
      return;
    }
    tasks.push(
      parser.getDependency('material', index).then((mat) => {
        mesh.material = mat;
        parser.assignFinalMaterial?.(mesh); // (re)configure skinning/vertex colors sur le matériau
      }),
    );
  });
  await Promise.all(tasks);
}
