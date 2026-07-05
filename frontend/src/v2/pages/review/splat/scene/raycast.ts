import type * as THREE from 'three';
import type { SplatMesh } from '@sparkjsdev/spark';
import type { Hotspot3D } from '../../reviewTypes';

/**
 * Hotspot de surface (10.G) : lance un rayon au centre du viewer (NDC 0,0) sur le splat
 * `raycastable` et renvoie le point le plus proche + une normale face caméra (les splats
 * n'ont pas de normale de surface). `null` si le rayon ne touche rien. Extrait de `useSplat`.
 */
export function raycastCenter(
  THREE: typeof import('three'),
  camera: THREE.PerspectiveCamera,
  mesh: SplatMesh,
): Hotspot3D | null {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const hits: { distance: number; point: THREE.Vector3; object: THREE.Object3D }[] = [];
  mesh.raycast(raycaster, hits);
  if (hits.length === 0) return null;
  hits.sort((a, b) => a.distance - b.distance);
  const p = hits[0]!.point;
  const n = camera.position.clone().sub(p).normalize();
  return { position: `${p.x} ${p.y} ${p.z}`, normal: `${n.x} ${n.y} ${n.z}` };
}
