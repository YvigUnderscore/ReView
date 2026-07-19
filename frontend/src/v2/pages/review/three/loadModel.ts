import type * as THREE from 'three';
import type { GLTF, GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Taille cible (plus grande dimension) du modèle normalisé — cadrage caméra cohérent. */
export const TARGET_SIZE = 2;

export interface Normalized {
  /** Facteur d'échelle appliqué au modèle (ramène la plus grande dimension à TARGET_SIZE). */
  scale: number;
  /** Position du modèle après mise à l'échelle pour recentrer sa bbox à l'origine. */
  position: THREE.Vector3;
  /** Rayon de la sphère englobante après mise à l'échelle (cadrage caméra). */
  radius: number;
}

/**
 * Normalisation d'un modèle par sa bbox (Phase 15, V1) : échelle unitaire + recentrage à
 * l'origine, pour un cadrage caméra cohérent quel que soit l'export. Pure/testable (prend une
 * `Box3` déjà calculée).
 */
export function normalizeTransform(three: typeof import('three'), box: THREE.Box3): Normalized {
  const size = box.getSize(new three.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const scale = maxDim > 0 ? TARGET_SIZE / maxDim : 1;
  const center = box.getCenter(new three.Vector3());
  const radius = box.getBoundingSphere(new three.Sphere()).radius * scale;
  // Après mise à l'échelle, translation pour amener le centre local à l'origine.
  return { scale, position: center.multiplyScalar(-scale), radius };
}

export interface LoadedModel {
  object: THREE.Object3D;
  animations: THREE.AnimationClip[];
  /** Rayon englobant après normalisation (auto-cadrage). */
  radius: number;
  /** Extensions glTF déclarées par le fichier (`extensionsUsed`) — fiche technique (39.C). */
  extensions: string[];
}

/**
 * Charge un GLB/glTF via `GLTFLoader` et le normalise (V1). Le backend convertit déjà
 * FBX/OBJ/USD → GLB (9.A1), donc DRACO/KTX2 restent optionnels (non câblés par défaut).
 */
export async function loadModel(
  three: typeof import('three'),
  loader: GLTFLoader,
  url: string,
): Promise<LoadedModel> {
  const gltf: GLTF = await loader.loadAsync(url);
  const object = gltf.scene;
  const box = new three.Box3().setFromObject(object);
  const { scale, position, radius } = normalizeTransform(three, box);
  object.scale.setScalar(scale);
  object.position.copy(position);
  const json = (gltf.parser?.json ?? {}) as { extensionsUsed?: unknown };
  const extensions = Array.isArray(json.extensionsUsed) ? (json.extensionsUsed as string[]) : [];
  return { object, animations: gltf.animations ?? [], radius, extensions };
}
