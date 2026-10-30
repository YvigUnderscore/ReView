// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import type { SplatCamera } from '../../reviewTypes';
import { registerSceneHelpers } from '../../viewer/sceneHelpers';

/**
 * Camera-object visible in the scene (Phase 17): a "camera" mesh (body + wireframe frustum)
 * oriented toward the target, a target marker, and the sampled **trajectory** of the animation
 * (polyline + key points). Rendered in the viewer's Three scene (splat or 3D). Impure (creates
 * Three objects) — the pose logic lives in `poseObject` (pure/tested). `size` scales it to the
 * scene.
 *
 * Two **visual feedback** rules, both needed so the artist sees what they adjust:
 * - **drawn over the scene** — what `renderOrder = 999` declared without achieving it: the plan's
 *   camera most often sits *inside* the splat cloud or behind the model, where depth made it
 *   simply vanish. It was never seen moving, and the gizmo had no visible grip. Three things were
 *   needed: no depth test, the transparent pass (the splats' one), and the render order set on
 *   **every** drawn object;
 * - **declared helper objects** (`viewer/sceneHelpers`): they are removed from the PiP pass, where
 *   they drew a rigid image relative to the plan's camera.
 */
export interface CameraObjectRuntime {
  /** Camera body (target of the position gizmo). */
  body: THREE.Group;
  /** Target marker (look-at) — movable to reorient the camera. */
  targetMarker: THREE.Mesh;
  update(pose: SplatCamera): void;
  setTrajectory(positions: Array<{ x: number; y: number; z: number }>): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

const PRIMARY = 0x00f0ff;
/** Last of the transparent pass: the plan's camera is visible over the scene. */
const RENDER_ORDER = 999;

export function createCameraObject(
  THREE: typeof import('three'),
  scene: THREE.Scene,
  size: number,
): CameraObjectRuntime {
  const body = new THREE.Group();
  const s = size;
  /**
   * Drawn over the scene: otherwise the model or the cloud hides the plan's camera.
   * `transparent` (at full opacity) for the **pass** only: Three draws transparents after the
   * opaques, and Spark's splats are among them. An opaque material, even without a depth test,
   * was thus covered by the cloud — and the plan's camera disappeared inside it, exactly where it
   * most often sits. `renderOrder` 999 puts it last in this pass.
   */
  const onTop = { depthTest: false, depthWrite: false, transparent: true } as const;

  // Body: small box (opaque) + frustum toward **+Z** (Object3D.lookAt orients +Z toward the target,
  // so the lens opens toward the target — Phase 27, fixes the "upside-down" orientation).
  const boxGeo = new THREE.BoxGeometry(s * 0.7, s * 0.5, s * 0.9);
  const boxMat = new THREE.MeshBasicMaterial({ color: PRIMARY, ...onTop });
  const boxWireMat = new THREE.MeshBasicMaterial({ color: 0x001018, wireframe: true, ...onTop });
  const box = new THREE.Mesh(boxGeo, boxMat);
  box.add(new THREE.Mesh(boxGeo, boxWireMat));
  body.add(box);

  const d = s * 1.2; // frustum depth
  const w = s * 0.7;
  const h = s * 0.5;
  const apex = new THREE.Vector3(0, 0, s * 0.45);
  const corners = [
    new THREE.Vector3(-w, -h, d),
    new THREE.Vector3(w, -h, d),
    new THREE.Vector3(w, h, d),
    new THREE.Vector3(-w, h, d),
  ];
  const pts: THREE.Vector3[] = [];
  corners.forEach((c) => {
    pts.push(apex.clone(), c.clone());
  });
  for (let i = 0; i < 4; i++) pts.push(corners[i].clone(), corners[(i + 1) % 4].clone());
  const frustumGeo = new THREE.BufferGeometry().setFromPoints(pts);
  const frustumMat = new THREE.LineBasicMaterial({ color: PRIMARY, ...onTop });
  body.add(new THREE.LineSegments(frustumGeo, frustumMat));
  // `renderOrder` is read **on the rendered object**, not on its parent: set on the Group alone, it
  // did nothing for the body or the frustum, which stayed at order 0.
  body.traverse((o) => {
    o.renderOrder = RENDER_ORDER;
  });
  scene.add(body);

  // Target marker (sphere).
  const targetMarker = new THREE.Mesh(
    new THREE.SphereGeometry(s * 0.28, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xff2095, ...onTop }),
  );
  targetMarker.renderOrder = RENDER_ORDER;
  scene.add(targetMarker);

  // Trajectory (polyline) + key points.
  const trajGeo = new THREE.BufferGeometry();
  const trajMat = new THREE.LineBasicMaterial({ color: PRIMARY, opacity: 0.6, ...onTop });
  const traj = new THREE.Line(trajGeo, trajMat);
  traj.renderOrder = RENDER_ORDER;
  scene.add(traj);

  // Helper objects: outside the PiP pass (see `viewer/sceneHelpers`).
  const unregister = registerSceneHelpers(body, targetMarker, traj);

  const _target = new THREE.Vector3();
  const update = (pose: SplatCamera) => {
    body.position.set(pose.position.x, pose.position.y, pose.position.z);
    _target.set(pose.target.x, pose.target.y, pose.target.z);
    body.lookAt(_target); // Group: orients +Z toward the target (frustum open toward the target)
    targetMarker.position.copy(_target);
  };

  const setTrajectory = (positions: Array<{ x: number; y: number; z: number }>) => {
    trajGeo.setFromPoints(positions.map((p) => new THREE.Vector3(p.x, p.y, p.z)));
    traj.visible = positions.length > 1;
  };

  const setVisible = (visible: boolean) => {
    body.visible = visible;
    targetMarker.visible = visible;
    traj.visible = visible && trajGeo.getAttribute('position')?.count > 1;
  };

  const dispose = () => {
    unregister();
    scene.remove(body, targetMarker, traj);
    boxGeo.dispose();
    boxMat.dispose();
    boxWireMat.dispose();
    frustumGeo.dispose();
    frustumMat.dispose();
    trajGeo.dispose();
    trajMat.dispose();
    (targetMarker.geometry as THREE.BufferGeometry).dispose();
    (targetMarker.material as THREE.Material).dispose();
  };

  return { body, targetMarker, update, setTrajectory, setVisible, dispose };
}
