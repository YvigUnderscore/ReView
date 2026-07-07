import type * as THREE from 'three';
import type { SplatSceneHandle } from '../../useSplat';

/** Forme du volume de crop. */
export type VolumeShape = 'box' | 'sphere';
/** Effet du volume : creuser (supprime l'intérieur) ou isoler (ne garde que l'intérieur). */
export type VolumeMode = 'delete' | 'isolate';

/** Couleurs des filaires de volume (rouge = creuser, vert = isoler) — constantes Three. */
const WIRE_DELETE = 0xef4444;
const WIRE_ISOLATE = 0x22c55e;

/** Objets Spark/Three d'un volume vivant dans la scène (non sérialisés — cf. H5). */
export interface VolumeRuntime {
  edit: THREE.Object3D & { invert: boolean };
  sdf: THREE.Object3D;
  wire: THREE.LineSegments;
}

/**
 * Volumes de crop SDF non-destructifs (10.G) : un `SplatEdit` (enfant du SplatMesh — usage
 * documenté Spark, pas de `editable` global) contenant un `SplatEditSdf` opacité 0 en mode
 * MULTIPLY — l'intérieur du volume est effacé du rendu ; `invert` sur l'édit isole au
 * contraire l'intérieur. Le SDF est un Object3D : le gizmo le déplace/tourne/redimensionne
 * nativement. Un filaire enfant matérialise le volume (rouge = creuser, vert = isoler).
 */
export async function createVolume(
  handle: SplatSceneHandle,
  shape: VolumeShape,
  mode: VolumeMode,
): Promise<VolumeRuntime> {
  const { THREE, mesh } = handle;
  const { SplatEdit, SplatEditRgbaBlendMode, SplatEditSdf, SplatEditSdfType } =
    await import('@sparkjsdev/spark');

  const edit = new SplatEdit({
    rgbaBlendMode: SplatEditRgbaBlendMode.MULTIPLY,
    invert: mode === 'isolate',
  });
  const sdf = new SplatEditSdf({
    type: shape === 'box' ? SplatEditSdfType.BOX : SplatEditSdfType.SPHERE,
    opacity: 0,
    color: new THREE.Color(1, 1, 1),
    radius: 1,
  });
  edit.addSdf(sdf);
  edit.add(sdf); // enfant → transform par le graphe de scène (gizmo)

  // Placement initial : centré sur la bbox du splat, dimensionné au tiers de son rayon.
  const box = mesh.getBoundingBox(true);
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, 0.001);
  sdf.position.copy(center);
  sdf.scale.setScalar(radius / 3);

  // Filaire de visualisation (unité : boîte 1³ / sphère r=1, suit l'échelle du SDF).
  const geo = shape === 'box' ? new THREE.BoxGeometry(1, 1, 1) : new THREE.SphereGeometry(1, 16, 12);
  const wire = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color: mode === 'delete' ? WIRE_DELETE : WIRE_ISOLATE }),
  );
  geo.dispose();
  sdf.add(wire);

  mesh.add(edit);
  return { edit, sdf, wire };
}

/** Change l'effet du volume (creuser ↔ isoler) et la couleur du filaire. */
export function setVolumeMode(runtime: VolumeRuntime, mode: VolumeMode): void {
  runtime.edit.invert = mode === 'isolate';
  (runtime.wire.material as THREE.LineBasicMaterial).color.setHex(
    mode === 'delete' ? WIRE_DELETE : WIRE_ISOLATE,
  );
}

/** Détache le volume de la scène (l'édit SDF cesse de s'appliquer) — ressources conservées
 * pour un ré-attachement (undo/redo). */
export function detachVolume(runtime: VolumeRuntime): void {
  runtime.edit.removeFromParent();
}

/** Ré-attache un volume détaché (redo d'un ajout / undo d'une suppression). */
export function reattachVolume(handle: SplatSceneHandle, runtime: VolumeRuntime): void {
  handle.mesh.add(runtime.edit);
}

/** Libération définitive (démontage de l'éditeur) : détache et libère le filaire. */
export function disposeVolume(runtime: VolumeRuntime): void {
  detachVolume(runtime);
  runtime.wire.geometry.dispose();
  (runtime.wire.material as THREE.Material).dispose();
}
