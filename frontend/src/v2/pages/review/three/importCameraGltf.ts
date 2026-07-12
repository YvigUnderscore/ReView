import type { SplatCamera, SplatCameraKeyframe, SplatLayoutAnim } from '../reviewTypes';
import { rollFromUp } from './cameraRoll';

/**
 * Import d'une **animation caméra** depuis un **glTF** (symétrique de `exportCameraGltf`) —
 * de nombreux logiciels 3D exportent des caméras glTF. Convertit les échantillons (position +
 * quaternion) en poses de review (position + cible + fov + roll).
 *
 * Note : l'import `.abc` (Alembic) demanderait un worker conteneurisé (parseur Ogawa) ; le glTF
 * est le format d'échange lisible côté client.
 */

export interface CameraSample {
  /** Temps en secondes. */
  t: number;
  pos: [number, number, number];
  quat: [number, number, number, number];
}

/**
 * Convertit des échantillons (position/quaternion glTF) en keyframes de review. Pur/testable :
 * la cible est dérivée de la direction de vue (quaternion) à distance `targetDist` ; le roll est
 * lu depuis le vecteur up de la caméra.
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

/** Assemble les échantillons depuis les pistes `.position` / `.quaternion` d'un clip glTF. */
export function samplesFromTracks(tracks: KeyframeTrackLike[]): CameraSample[] {
  const posT = tracks.find((t) => t.name.endsWith('.position'));
  const rotT = tracks.find((t) => t.name.endsWith('.quaternion'));
  if (!posT) return [];
  const samples: CameraSample[] = [];
  for (let i = 0; i < posT.times.length; i++) {
    const quat: [number, number, number, number] =
      rotT && rotT.values.length >= (i + 1) * 4
        ? [rotT.values[i * 4]!, rotT.values[i * 4 + 1]!, rotT.values[i * 4 + 2]!, rotT.values[i * 4 + 3]!]
        : [0, 0, 0, 1];
    samples.push({
      t: posT.times[i]!,
      pos: [posT.values[i * 3]!, posT.values[i * 3 + 1]!, posT.values[i * 3 + 2]!],
      quat,
    });
  }
  return samples;
}

/** Charge un fichier glTF/GLB et en extrait l'animation caméra (runtime). `null` si absente. */
export async function importCameraFromGltf(file: File): Promise<SplatLayoutAnim | null> {
  const three = await import('three');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  const buf = await file.arrayBuffer();
  const gltf = await new Promise<{
    scene: import('three').Object3D;
    animations: Array<{ tracks: KeyframeTrackLike[] }>;
  }>((resolve, reject) => loader.parse(buf, '', resolve as never, reject));
  let fovDeg = 45;
  gltf.scene.traverse((o) => {
    const cam = o as unknown as { isCamera?: boolean; fov?: number };
    if (cam.isCamera && cam.fov != null) fovDeg = cam.fov;
  });
  const clip = gltf.animations?.[0];
  if (!clip) return null;
  const samples = samplesFromTracks(clip.tracks);
  if (samples.length < 2) return null;
  return { keyframes: keyframesFromSamples(three, samples, fovDeg), loop: false, smooth: false };
}
