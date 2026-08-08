// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import type { GLTF, GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Taille cible (plus grande dimension) du modèle normalisé — cadrage caméra cohérent. */
export const TARGET_SIZE = 2;

export interface Normalized {
  /** Facteur d'échelle appliqué au modèle (ramène la plus grande dimension à TARGET_SIZE). */
  scale: number;
  /** Position du modèle après mise à l'échelle : centré en X/Z, bas de bbox posé sur `y = 0`. */
  position: THREE.Vector3;
  /** Centre de la bbox **après** normalisation — cible de cadrage caméra (jamais l'origine). */
  center: THREE.Vector3;
  /** Rayon de la sphère englobante après mise à l'échelle (cadrage caméra). */
  radius: number;
}

/**
 * Normalisation d'un modèle par sa bbox (Phase 15, V1) : échelle unitaire, centrage horizontal et
 * **appui au sol**, pour un cadrage caméra cohérent quel que soit l'export. Pure/testable (prend
 * une `Box3` déjà calculée).
 *
 * Le sol du viewer est le plan `y = 0` (grille `useSceneGrid`) : ramener le **centre** de la bbox à
 * l'origine, comme le faisait la V1, enfonçait donc systématiquement la moitié basse du modèle sous
 * la grille. On ramène le **bas** de la bbox à `y = 0` — ce qui reposait sur le sol dans le DCC
 * repose sur le sol dans la review — et `center` porte le centre réel du modèle pour que le cadrage
 * caméra vise l'objet et non le sol.
 */
export function normalizeTransform(three: typeof import('three'), box: THREE.Box3): Normalized {
  const size = box.getSize(new three.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const scale = maxDim > 0 ? TARGET_SIZE / maxDim : 1;
  const center = box.getCenter(new three.Vector3());
  const radius = box.getBoundingSphere(new three.Sphere()).radius * scale;
  const position = new three.Vector3(-center.x * scale, -box.min.y * scale, -center.z * scale);
  return { scale, position, center: new three.Vector3(0, (size.y * scale) / 2, 0), radius };
}

/**
 * Désactive le frustum culling des meshes déformés (Phase 40, 40.A) : la bounding box d'un
 * `SkinnedMesh` (ou d'un mesh à morph targets) est figée sur la bind pose et **ne suit pas** la
 * déformation animée — Three.js peut alors culer/faire disparaître le mesh quand il sort de sa
 * bbox statique. Renvoie le nombre de meshes déformables trouvés (skinning présent → 40.B).
 */
export function markDeformableMeshes(root: THREE.Object3D): number {
  let count = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh & { isSkinnedMesh?: boolean; morphTargetInfluences?: number[] };
    if (mesh.isSkinnedMesh || (mesh.morphTargetInfluences && mesh.morphTargetInfluences.length)) {
      mesh.frustumCulled = false;
      if (mesh.isSkinnedMesh) count += 1;
    }
  });
  return count;
}

export interface LoadedModel {
  /** Groupe **wrapper** portant la normalisation (échelle + recentrage) — ajouté à la scène et
   *  cible de la transformation utilisateur. Sa transform n'est jamais touchée par le mixer. */
  object: THREE.Object3D;
  /** Racine glTF d'origine (enfant du wrapper, transform d'identité) — **cible de l'AnimationMixer**
   *  pour que les pistes ciblant le nœud racine (root-motion, scale) n'écrasent pas la normalisation. */
  animRoot: THREE.Object3D;
  animations: THREE.AnimationClip[];
  /** Rayon englobant après normalisation (auto-cadrage). */
  radius: number;
  /** Centre du modèle après normalisation — cible caméra (le modèle repose sur `y = 0`). */
  center: THREE.Vector3;
  /** Extensions glTF déclarées par le fichier (`extensionsUsed`) — fiche technique (39.C). */
  extensions: string[];
  /** Nombre de `SkinnedMesh` (rig présent → active le debug squelette 40.B). */
  skinnedCount: number;
  /** Objet glTF chargé (parser + userData.variants + cameras) — variantes & caméras embarquées (40.C). */
  gltf: GLTF;
}

/**
 * Charge un GLB/glTF via `GLTFLoader` et le normalise (V1). Le backend convertit déjà
 * FBX/OBJ/USD → GLB (9.A1), donc DRACO/KTX2 restent optionnels (non câblés par défaut).
 *
 * Phase 40 (40.A) : la normalisation est portée par un **wrapper `Group`** ; la scène glTF reste à
 * l'identité et sert de cible au mixer — ainsi une piste d'animation sur le nœud racine ne casse
 * plus le cadrage. Les meshes déformables sont exemptés de frustum culling (skinning fiable).
 */
export async function loadModel(
  three: typeof import('three'),
  loader: GLTFLoader,
  url: string,
): Promise<LoadedModel> {
  const gltf: GLTF = await loader.loadAsync(url);
  const animRoot = gltf.scene;
  const box = new three.Box3().setFromObject(animRoot);
  const { scale, position, center, radius } = normalizeTransform(three, box);
  // Wrapper de normalisation : la scène glTF reste intacte (transform d'identité).
  const object = new three.Group();
  object.name = 'model-normalized';
  object.scale.setScalar(scale);
  object.position.copy(position);
  object.add(animRoot);
  const skinnedCount = markDeformableMeshes(animRoot);
  const json = (gltf.parser?.json ?? {}) as { extensionsUsed?: unknown };
  const extensions = Array.isArray(json.extensionsUsed) ? (json.extensionsUsed as string[]) : [];
  return {
    object,
    animRoot,
    animations: gltf.animations ?? [],
    radius,
    center,
    extensions,
    skinnedCount,
    gltf,
  };
}
