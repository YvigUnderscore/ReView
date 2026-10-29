// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SplatCamera, SplatCameraKeyframe } from '../reviewTypes';
import { applyPoseToCamera } from './applyPose';
import { bakeToKeyframes } from '../camera/channels/hermite';
import type { CameraAnimV2 } from '../camera/channels/model';

/**
 * Export of a **camera animation** (review keyframes) to a minimal **glTF 2.0**: an animated
 * perspective camera with translation and rotation, importable into 3D software (Blender, Maya,
 * Houdini). Hand-generated (deterministic and testable) rather than via `GLTFExporter`, whose
 * camera-animation export has subtleties that cannot be verified without a browser.
 *
 * Note: the `.abc` format (Alembic) would require an Ogawa writer (containerised worker); glTF is the
 * universally importable interchange that can be produced client-side.
 */

const F32 = 5126; // glTF componentType FLOAT

/** Encodes an ArrayBuffer in base64 (btoa is available in the browser and in the happy-dom test environment). */
function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/**
 * Builds the glTF object (binary buffer embedded as a data URI) for the camera animation. Pure:
 * `three` is only used to derive the rotation (quaternion) of each pose via `applyPoseToCamera`.
 */
export function buildCameraGltf(
  three: typeof import('three'),
  keyframes: SplatCameraKeyframe[],
  name = 'ReviewCamera',
): Record<string, unknown> {
  const n = keyframes.length;
  const times = new Float32Array(n);
  const translations = new Float32Array(n * 3);
  const rotations = new Float32Array(n * 4);
  const cam = new three.PerspectiveCamera();
  keyframes.forEach((k, i) => {
    times[i] = k.t / 1000; // ms → seconds
    applyPoseToCamera(three, cam, k.pose);
    translations[i * 3] = cam.position.x;
    translations[i * 3 + 1] = cam.position.y;
    translations[i * 3 + 2] = cam.position.z;
    rotations[i * 4] = cam.quaternion.x;
    rotations[i * 4 + 1] = cam.quaternion.y;
    rotations[i * 4 + 2] = cam.quaternion.z;
    rotations[i * 4 + 3] = cam.quaternion.w;
  });

  // Single buffer: [times | translations | rotations], all float32 (4-byte aligned).
  const tBytes = n * 4;
  const trBytes = n * 12;
  const rBytes = n * 16;
  const buf = new ArrayBuffer(tBytes + trBytes + rBytes);
  new Float32Array(buf, 0, n).set(times);
  new Float32Array(buf, tBytes, n * 3).set(translations);
  new Float32Array(buf, tBytes + trBytes, n * 4).set(rotations);

  const minT = times.length ? times[0] : 0;
  const maxT = times.length ? times[times.length - 1] : 0;
  const fovDeg = keyframes[0]?.pose.fov ?? 45;

  return {
    asset: { version: '2.0', generator: 'ReView camera export' },
    scenes: [{ nodes: [0] }],
    scene: 0,
    nodes: [{ name, camera: 0 }],
    cameras: [
      {
        type: 'perspective',
        name,
        perspective: { yfov: (fovDeg * Math.PI) / 180, znear: 0.01, zfar: 1000 },
      },
    ],
    animations: [
      {
        name: 'CameraAnimation',
        samplers: [
          { input: 0, output: 1, interpolation: 'LINEAR' },
          { input: 0, output: 2, interpolation: 'LINEAR' },
        ],
        channels: [
          { sampler: 0, target: { node: 0, path: 'translation' } },
          { sampler: 1, target: { node: 0, path: 'rotation' } },
        ],
      },
    ],
    accessors: [
      { bufferView: 0, componentType: F32, count: n, type: 'SCALAR', min: [minT], max: [maxT] },
      { bufferView: 1, componentType: F32, count: n, type: 'VEC3' },
      { bufferView: 2, componentType: F32, count: n, type: 'VEC4' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: tBytes },
      { buffer: 0, byteOffset: tBytes, byteLength: trBytes },
      { buffer: 0, byteOffset: tBytes + trBytes, byteLength: rBytes },
    ],
    buffers: [{ byteLength: buf.byteLength, uri: `data:application/octet-stream;base64,${toBase64(buf)}` }],
  };
}

/** Triggers the download of the camera animation's glTF (three imported on the fly). */
export async function downloadCameraGltf(
  keyframes: SplatCameraKeyframe[],
  filename = 'review-camera.gltf',
): Promise<void> {
  const three = await import('three');
  const gltf = buildCameraGltf(three, keyframes);
  const blob = new Blob([JSON.stringify(gltf)], { type: 'model/gltf+json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Neutral base for the export bake (animated channels take precedence; default fov if not animated). */
const EXPORT_BASE: SplatCamera = { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 }, fov: 45 };

/** Exports a camera animation v2 (F-curves): baked into keyframes, then glTF download. */
export async function downloadAnimGltf(anim: CameraAnimV2, filename = 'review-camera.gltf'): Promise<void> {
  await downloadCameraGltf(bakeToKeyframes(anim, EXPORT_BASE), filename);
}
