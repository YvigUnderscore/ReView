// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import type { SplatSceneHandle } from '../../useSplat';

/** Shape of the crop volume. */
export type VolumeShape = 'box' | 'sphere';
/** Volume effect: carve (removes the interior) or isolate (keeps only the interior). */
export type VolumeMode = 'delete' | 'isolate';

/** Wireframe colours of the volumes (red = carve, green = isolate): Three constants. */
const WIRE_DELETE = 0xef4444;
const WIRE_ISOLATE = 0x22c55e;

/** Spark/Three objects of a volume alive in the scene (not serialized, see H5). */
export interface VolumeRuntime {
  edit: THREE.Object3D & { invert: boolean };
  sdf: THREE.Object3D & { radius: number };
  wire: THREE.LineSegments;
}

/**
 * Non-destructive SDF crop volumes (10.G): a `SplatEdit` (child of the SplatMesh, documented Spark
 * usage, no global `editable`) containing a `SplatEditSdf` with opacity 0 in MULTIPLY mode: the
 * interior of the volume is erased from the rendering; `invert` on the edit instead isolates the
 * interior. The SDF is an Object3D: the gizmo moves, rotates and resizes it natively. A child
 * wireframe represents the volume (red = carve, green = isolate).
 *
 * Wireframe ↔ SDF correspondence (11.F; Phase 28, ellipsoid): box → half-extents = `scale`
 * (wireframe 2×2×2, `radius` 0 = no rounding); "sphere" → **ELLIPSOID** (half-axes = `scale`,
 * `radius` 0), so **non-uniform** resizing is native (the scale of the 3 axes is respected).
 */
export async function createVolume(
  handle: SplatSceneHandle,
  shape: VolumeShape,
  mode: VolumeMode,
  /** Visible wireframe (true when editing; false read-only: the volume acts without being seen). */
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
    // "Sphere" = ELLIPSOID (half-axes = scale) → correct non-uniform resize (Phase 28).
    type: shape === 'box' ? SplatEditSdfType.BOX : SplatEditSdfType.ELLIPSOID,
    opacity: 0,
    color: new THREE.Color(1, 1, 1),
    radius: 0, // no rounding: box and ellipsoid both take their size from `scale`
  });
  edit.addSdf(sdf);
  edit.add(sdf); // child: transform handled by the scene graph (gizmo)

  // Initial placement: centred on the splat's bbox, sized to a third of its radius.
  const box = mesh.getBoundingBox(true);
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, 0.001);
  sdf.position.copy(center);
  sdf.scale.setScalar(radius / 3);

  // Visualization wireframe, matched to the volume actually carved: 2³ box (half-extent 1,
  // follows `scale` = SDF half-extents) / sphere r=1 (follows `scale`, from which the SDF radius is derived).
  const geo = shape === 'box' ? new THREE.BoxGeometry(2, 2, 2) : new THREE.SphereGeometry(1, 16, 12);
  const wire = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color: mode === 'delete' ? WIRE_DELETE : WIRE_ISOLATE }),
  );
  geo.dispose();
  wire.visible = showWire;
  sdf.add(wire);

  mesh.add(edit);
  return { edit, sdf: sdf, wire };
}

/** Applies a serialized TRS to the volume's SDF (reload of persisted edits). */
export function applyVolumeData(
  runtime: VolumeRuntime,
  data: { position: number[]; quaternion: number[]; scale: number[] },
): void {
  runtime.sdf.position.fromArray(data.position);
  runtime.sdf.quaternion.fromArray(data.quaternion);
  runtime.sdf.scale.fromArray(data.scale);
}

/** Changes the volume's effect (carve ↔ isolate) and the wireframe colour. */
export function setVolumeMode(runtime: VolumeRuntime, mode: VolumeMode): void {
  runtime.edit.invert = mode === 'isolate';
  (runtime.wire.material as THREE.LineBasicMaterial).color.setHex(
    mode === 'delete' ? WIRE_DELETE : WIRE_ISOLATE,
  );
}

/** Detaches the volume from the scene (the SDF edit stops applying); resources are kept
 * for a re-attachment (undo/redo). */
export function detachVolume(runtime: VolumeRuntime): void {
  runtime.edit.removeFromParent();
}

/** Re-attaches a detached volume (redo of an addition / undo of a deletion). */
export function reattachVolume(handle: SplatSceneHandle, runtime: VolumeRuntime): void {
  handle.mesh.add(runtime.edit);
}

/** Final release (editor unmount): detaches and releases the wireframe. */
export function disposeVolume(runtime: VolumeRuntime): void {
  detachVolume(runtime);
  runtime.wire.geometry.dispose();
  (runtime.wire.material as THREE.Material).dispose();
}
