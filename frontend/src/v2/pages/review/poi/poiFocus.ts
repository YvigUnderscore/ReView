// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Hotspot3D } from '../reviewTypes';
import { toMarkerPoint } from '../three/objectHotspot';
import { frameCameraToSphere } from '../viewer/frameCamera';

/**
 * Camera return to a point of interest: clicking its number in the thread brings the view back onto it,
 * in both spatial viewers (the same code, called with the object carrying the media).
 *
 * The point is in OBJECT space: it is projected through the object's world matrix, so the view lands in
 * the same place for every viewer, whatever transformation is applied to the media. Same rule as the
 * camera presentation.
 */

/**
 * Share of the scene that the framing of a point occupies. A point has no size: without this fraction,
 * `frameCameraToSphere` would have no radius to respect and the camera would stick to it. Twelve percent
 * leaves room to see the defect **and** what surrounds it.
 */
export const POI_FOCUS_RATIO = 0.12;

/** Framing radius of a point, never null: otherwise the framing would be refused. */
export function poiFocusRadius(sceneRadius: number): number {
  const radius = Number.isFinite(sceneRadius) ? Math.abs(sceneRadius) : 0;
  return Math.max(radius * POI_FOCUS_RATIO, 1e-3);
}

/** Frames the camera on a point. `false` if the position is unreadable (nothing has moved). */
export function focusObjectPoint(params: {
  three: typeof import('three');
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  /** Carrying object: the group of the 3D model, or the `SplatMesh` of the cloud. */
  object: THREE.Object3D;
  point: Hotspot3D;
  /** Radius of the scene: the framing scale depends on it (a cloud is not a bolt). */
  sceneRadius: number;
}): boolean {
  const { three, camera, controls, object, point, sceneRadius } = params;
  const marker = toMarkerPoint(three, point);
  if (!marker) return false;
  const center = marker.point.clone();
  if (marker.objectSpace) {
    object.updateMatrixWorld();
    center.applyMatrix4(object.matrixWorld);
  }
  return frameCameraToSphere(camera, controls, center, poiFocusRadius(sceneRadius));
}
