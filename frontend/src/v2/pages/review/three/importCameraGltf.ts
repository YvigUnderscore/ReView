// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SplatCamera, SplatCameraKeyframe, SplatLayoutAnim } from '../reviewTypes';
import { rollFromUp } from './cameraRoll';
import { fromV1 } from '../camera/channels/model';

/**
 * Import of a **camera animation** from a **glTF** (symmetric to `exportCameraGltf`): many 3D
 * packages export glTF cameras. Converts the samples (position and quaternion) into review poses
 * (position, target, fov and roll).
 *
 * Note: the `.abc` import (Alembic) would require a containerised worker (Ogawa parser); glTF is
 * the readable exchange format on the client side.
 */

export interface CameraSample {
  /** Time in seconds. */
  t: number;
  pos: [number, number, number];
  quat: [number, number, number, number];
}

/**
 * Converts samples (glTF position and quaternion) into review keyframes. Pure and testable: the
 * target is derived from the view direction (quaternion) at distance `targetDist`; the roll is read
 * from the camera's up vector.
 */
export function keyframesFromSamples(
  three: typeof import('three'),
  samples: CameraSample[],
  fovDeg = 45,
  targetDist = 1,
): SplatCameraKeyframe[] {
  return samples.map((s) => {
    const q = new three.Quaternion(s.quat[0], s.quat[1], s.quat[2], s.quat[3]).normalize();
    const forward = new three.Vector3(0, 0, -1).applyQuaternion(q).normalize();
    const up = new three.Vector3(0, 1, 0).applyQuaternion(q).normalize();
    const position = { x: s.pos[0], y: s.pos[1], z: s.pos[2] };
    const target = {
      x: position.x + forward.x * targetDist,
      y: position.y + forward.y * targetDist,
      z: position.z + forward.z * targetDist,
    };
    const roll = rollFromUp(three, forward, up);
    const pose: SplatCamera = { position, target, fov: fovDeg };
    if (Math.abs(roll) > 1e-4) pose.roll = roll;
    return { t: s.t * 1000, pose, easing: 'linear' as const };
  });
}

interface KeyframeTrackLike {
  name: string;
  times: ArrayLike<number>;
  values: ArrayLike<number>;
}

/** Assembles the samples from the `.position` and `.quaternion` tracks of a glTF clip. */
export function samplesFromTracks(tracks: KeyframeTrackLike[]): CameraSample[] {
  const posT = tracks.find((t) => t.name.endsWith('.position'));
  const rotT = tracks.find((t) => t.name.endsWith('.quaternion'));
  if (!posT) return [];
  const samples: CameraSample[] = [];
  for (let i = 0; i < posT.times.length; i++) {
    const quat: [number, number, number, number] =
      rotT && rotT.values.length >= (i + 1) * 4
        ? [rotT.values[i * 4], rotT.values[i * 4 + 1], rotT.values[i * 4 + 2], rotT.values[i * 4 + 3]]
        : [0, 0, 0, 1];
    samples.push({
      t: posT.times[i],
      pos: [posT.values[i * 3], posT.values[i * 3 + 1], posT.values[i * 3 + 2]],
      quat,
    });
  }
  return samples;
}

/** Loads a glTF/GLB file and extracts the camera animation from it (runtime). `null` if absent. */
export async function importCameraFromGltf(file: File): Promise<SplatLayoutAnim | null> {
  const three = await import('three');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  const buf = await file.arrayBuffer();
  const gltf = await new Promise<{
    scene: import('three').Object3D;
    animations: Array<{ tracks: KeyframeTrackLike[] }>;
  }>((resolve, reject) => loader.parse(buf, '', resolve, reject));
  let fovDeg = 45;
  gltf.scene.traverse((o) => {
    const cam = o as unknown as { isCamera?: boolean; fov?: number };
    if (cam.isCamera && cam.fov != null) fovDeg = cam.fov;
  });
  const clip = gltf.animations?.[0];
  if (!clip) return null;
  const samples = samplesFromTracks(clip.tracks);
  if (samples.length < 2) return null;
  // The glTF samples (linear) → v1 keyframes → v2 animation per channel (`linear` mode).
  return fromV1(keyframesFromSamples(three, samples, fovDeg), false);
}
