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
  sdf: THREE.Object3D & { radius: number };
  wire: THREE.LineSegments;
}

/**
 * Synchronise le rayon effectif d'un SDF sphère sur son échelle (11.F) : le shader Spark
 * ignore `scale` pour la sphère — le volume réellement creusé a pour rayon `sdf.radius` seul.
 * Sans cette recopie, le gizmo (qui agit sur `scale`) grossissait le filaire mais pas le crop.
 * Échelle anisotrope : moyenne des composantes (le SDF sphère est isotrope par nature).
 */
export function syncSphereRadius(sdf: THREE.Object3D): void {
  if (sdf.userData.volumeShape !== 'sphere') return;
  const s = sdf.scale;
  (sdf as unknown as { radius: number }).radius = (Math.abs(s.x) + Math.abs(s.y) + Math.abs(s.z)) / 3;
}

/**
 * Volumes de crop SDF non-destructifs (10.G) : un `SplatEdit` (enfant du SplatMesh — usage
 * documenté Spark, pas de `editable` global) contenant un `SplatEditSdf` opacité 0 en mode
 * MULTIPLY — l'intérieur du volume est effacé du rendu ; `invert` sur l'édit isole au
 * contraire l'intérieur. Le SDF est un Object3D : le gizmo le déplace/tourne/redimensionne
 * nativement. Un filaire enfant matérialise le volume (rouge = creuser, vert = isoler).
 *
 * Correspondance filaire ↔ SDF (11.F, sémantique shader Spark) : boîte → demi-extents =
 * `scale` (filaire 2×2×2, `radius` 0 = pas d'arrondi de coins) ; sphère → rayon = `radius`,
 * recopié depuis `scale` (cf. syncSphereRadius).
 */
export async function createVolume(
  handle: SplatSceneHandle,
  shape: VolumeShape,
  mode: VolumeMode,
  /** Filaire visible (true en édition ; false en lecture seule — le volume agit sans se voir). */
  showWire = true,
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
    radius: 0, // boîte : aucun arrondi ; sphère : recopié depuis l'échelle juste après
  });
  sdf.userData.volumeShape = shape;
  edit.addSdf(sdf);
  edit.add(sdf); // enfant → transform par le graphe de scène (gizmo)

  // Placement initial : centré sur la bbox du splat, dimensionné au tiers de son rayon.
  const box = mesh.getBoundingBox(true);
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, 0.001);
  sdf.position.copy(center);
  sdf.scale.setScalar(radius / 3);
  syncSphereRadius(sdf);

  // Filaire de visualisation, calé sur le volume réellement creusé : boîte 2³ (demi-extent 1,
  // suit `scale` = demi-extents SDF) / sphère r=1 (suit `scale`, dont le rayon SDF est dérivé).
  const geo = shape === 'box' ? new THREE.BoxGeometry(2, 2, 2) : new THREE.SphereGeometry(1, 16, 12);
  const wire = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color: mode === 'delete' ? WIRE_DELETE : WIRE_ISOLATE }),
  );
  geo.dispose();
  wire.visible = showWire;
  sdf.add(wire);

  mesh.add(edit);
  return { edit, sdf: sdf as VolumeRuntime['sdf'], wire };
}

/** Applique une TRS sérialisée au SDF du volume (rechargement d'éditions persistées). */
export function applyVolumeData(
  runtime: VolumeRuntime,
  data: { position: number[]; quaternion: number[]; scale: number[] },
): void {
  runtime.sdf.position.fromArray(data.position);
  runtime.sdf.quaternion.fromArray(data.quaternion);
  runtime.sdf.scale.fromArray(data.scale);
  // Volumes persistés avant 11.F : le rayon sphère est re-dérivé de l'échelle (migration lecture).
  syncSphereRadius(runtime.sdf);
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
