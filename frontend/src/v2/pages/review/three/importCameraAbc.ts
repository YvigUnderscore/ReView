// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SplatCamera, SplatCameraKeyframe, SplatLayoutAnim } from '../reviewTypes';
import { rollFromUp } from './cameraRoll';
import { fromV1 } from '../camera/channels/model';
import { importCameraFromGltf } from './importCameraGltf';

/**
 * Import d'une **caméra Alembic (.abc)** dans l'animation caméra v2 (Phase 40, 40.D). Alembic est
 * un format binaire (Ogawa) : son parsing natif demande un **worker conteneurisé** (non embarqué —
 * cf. `DOCUMENTATION/admin-guide/3d-alembic.md`). L'échange lisible côté client est un **JSON
 * d'échantillons** produit par un extracteur externe (script Blender/PyAlembic fourni dans la doc).
 * Ce module convertit ces échantillons (position + quaternion **ou** cible, fov optionnel) en
 * keyframes v2. Pur/testable — symétrique de `importCameraGltf`.
 */

/** Un échantillon caméra : temps (s) **ou** numéro de frame, position, orientation (quat) ou cible. */
export interface AbcCameraSample {
  /** Temps en secondes (prioritaire sur `frame`). */
  t?: number;
  /** Numéro de frame (converti via `fps` si `t` absent). */
  frame?: number;
  pos: [number, number, number];
  /** Quaternion xyzw (la cible est dérivée de la direction de vue). */
  quat?: [number, number, number, number];
  /** Cible explicite (prioritaire sur `quat`). */
  target?: [number, number, number];
  /** Focale en degrés (sinon `fovDeg` du document, sinon 45). */
  fov?: number;
}

export interface AbcCameraDoc {
  /** Cadence pour convertir `frame`→secondes (défaut 24). */
  fps?: number;
  /** Focale par défaut en degrés (défaut 45). */
  fovDeg?: number;
  samples: AbcCameraSample[];
}

const isVec3 = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) && v.length >= 3 && v.every((n) => typeof n === 'number');

/**
 * Convertit un document d'échantillons Alembic en animation caméra v2 (pur/testable). `null` si
 * moins de 2 échantillons exploitables. Les temps deviennent des ms ; l'interpolation est linéaire
 * (échantillons denses). La cible vient de `target` sinon du quaternion (regard -Z), le roll du up.
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

/** Charge un fichier JSON d'échantillons Alembic et en dérive l'animation caméra. `null` si vide. */
export async function importCameraFromAbc(file: File): Promise<SplatLayoutAnim | null> {
  const three = await import('three');
  const text = await file.text();
  const doc = JSON.parse(text) as AbcCameraDoc;
  return abcDocToAnim(three, doc);
}

/**
 * Aiguillage d'import de caméra selon l'extension : `.json` → échantillons Alembic (40.D), sinon
 * glTF/GLB (`importCameraFromGltf`). Utilisé par les deux viewers (3D & splat).
 */
export function importCameraFile(file: File): Promise<SplatLayoutAnim | null> {
  return /\.json$/i.test(file.name) ? importCameraFromAbc(file) : importCameraFromGltf(file);
}
