// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SplatCamera, SplatCameraKeyframe, SplatLayoutAnim } from '../reviewTypes';
import { rollFromUp } from './cameraRoll';
import { fromV1 } from '../camera/channels/model';
import { importCameraFromGltf } from './importCameraGltf';

/**
 * Import of an **Alembic (.abc) camera** into the v2 camera animation (Phase 40, 40.D). Alembic is
 * a binary format (Ogawa): its native parsing requires a **containerised worker** (not bundled:
 * cf. `DOCUMENTATION/admin-guide/3d-alembic.md`). The readable exchange on the client side is a **JSON
 * of samples** produced by an external extractor (Blender/PyAlembic script provided in the docs).
 * This module converts these samples (position and quaternion **or** target, optional fov) into
 * v2 keyframes. Pure and testable: symmetric to `importCameraGltf`.
 */

/** A camera sample: time (s) **or** frame number, position, orientation (quat) or target. */
export interface AbcCameraSample {
  /** Time in seconds (takes precedence over `frame`). */
  t?: number;
  /** Frame number (converted via `fps` if `t` is absent). */
  frame?: number;
  pos: [number, number, number];
  /** xyzw quaternion (the target is derived from the view direction). */
  quat?: [number, number, number, number];
  /** Explicit target (takes precedence over `quat`). */
  target?: [number, number, number];
  /** Focal length in degrees (otherwise the `fovDeg` of the document, otherwise 45). */
  fov?: number;
}

export interface AbcCameraDoc {
  /** Frame rate used to convert `frame` to seconds (default 24). */
  fps?: number;
  /** Default focal length in degrees (default 45). */
  fovDeg?: number;
  samples: AbcCameraSample[];
}

const isVec3 = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) && v.length >= 3 && v.every((n) => typeof n === 'number');

/**
 * Converts an Alembic sample document into a v2 camera animation (pure and testable). `null` if
 * fewer than 2 usable samples. Times become ms; interpolation is linear (dense samples).
 * The target comes from `target`, otherwise from the quaternion (looking along -Z); the roll from the up.
 */
export function abcDocToAnim(three: typeof import('three'), doc: AbcCameraDoc): SplatLayoutAnim | null {
  const samples = Array.isArray(doc?.samples) ? doc.samples : [];
  const fps = doc.fps && doc.fps > 0 ? doc.fps : 24;
  const defaultFov = typeof doc.fovDeg === 'number' ? doc.fovDeg : 45;
  const keyframes: SplatCameraKeyframe[] = [];
  samples.forEach((s, i) => {
    if (!isVec3(s.pos)) return;
    const tSec = typeof s.t === 'number' ? s.t : typeof s.frame === 'number' ? s.frame / fps : i / fps;
    const position = { x: s.pos[0], y: s.pos[1], z: s.pos[2] };
    const fov = typeof s.fov === 'number' ? s.fov : defaultFov;
    let target: { x: number; y: number; z: number };
    let roll = 0;
    if (isVec3(s.target)) {
      target = { x: s.target[0], y: s.target[1], z: s.target[2] };
    } else if (Array.isArray(s.quat) && s.quat.length >= 4) {
      const q = new three.Quaternion(s.quat[0], s.quat[1], s.quat[2], s.quat[3]).normalize();
      const forward = new three.Vector3(0, 0, -1).applyQuaternion(q).normalize();
      const up = new three.Vector3(0, 1, 0).applyQuaternion(q).normalize();
      target = { x: position.x + forward.x, y: position.y + forward.y, z: position.z + forward.z };
      roll = rollFromUp(three, forward, up);
    } else {
      target = { x: position.x, y: position.y, z: position.z - 1 };
    }
    const pose: SplatCamera = { position, target, fov };
    if (Math.abs(roll) > 1e-4) pose.roll = roll;
    keyframes.push({ t: tSec * 1000, pose, easing: 'linear' as const });
  });
  if (keyframes.length < 2) return null;
  return fromV1(keyframes, false);
}

/** Loads an Alembic sample JSON file and derives the camera animation from it. `null` if empty. */
export async function importCameraFromAbc(file: File): Promise<SplatLayoutAnim | null> {
  const three = await import('three');
  const text = await file.text();
  const doc = JSON.parse(text) as AbcCameraDoc;
  return abcDocToAnim(three, doc);
}

/**
 * Camera import dispatch by extension: `.json` goes to Alembic samples (40.D), otherwise
 * glTF/GLB (`importCameraFromGltf`). Used by both viewers (3D and splat).
 */
export function importCameraFile(file: File): Promise<SplatLayoutAnim | null> {
  return /\.json$/i.test(file.name) ? importCameraFromAbc(file) : importCameraFromGltf(file);
}
