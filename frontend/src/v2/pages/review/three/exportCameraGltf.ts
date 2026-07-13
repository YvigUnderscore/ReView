import type { SplatCamera, SplatCameraKeyframe } from '../reviewTypes';
import { applyPoseToCamera } from './applyPose';
import { bakeToKeyframes } from '../camera/channels/hermite';
import type { CameraAnimV2 } from '../camera/channels/model';

/**
 * Export d'une **animation caméra** (keyframes de review) vers un **glTF 2.0** minimal —
 * caméra perspective animée en translation + rotation, importable dans un logiciel 3D
 * (Blender/Maya/Houdini). Généré à la main (déterministe/testable) plutôt que via `GLTFExporter`,
 * dont l'export d'animation caméra a des subtilités non vérifiables sans navigateur.
 *
 * Note : le format `.abc` (Alembic) demanderait un writer Ogawa (worker conteneurisé) ; le glTF
 * est l'interchange universellement importable produisible côté client.
 */

const F32 = 5126; // GLTF componentType FLOAT

/** Encode un ArrayBuffer en base64 (btoa dispo navigateur + env de test happy-dom). */
function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

/**
 * Construit l'objet glTF (buffer binaire embarqué en data-URI) pour l'animation caméra. Pur :
 * `three` sert uniquement à dériver la rotation (quaternion) de chaque pose via `applyPoseToCamera`.
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
    times[i] = k.t / 1000; // ms → secondes
    applyPoseToCamera(three, cam, k.pose);
    translations[i * 3] = cam.position.x;
    translations[i * 3 + 1] = cam.position.y;
    translations[i * 3 + 2] = cam.position.z;
    rotations[i * 4] = cam.quaternion.x;
    rotations[i * 4 + 1] = cam.quaternion.y;
    rotations[i * 4 + 2] = cam.quaternion.z;
    rotations[i * 4 + 3] = cam.quaternion.w;
  });

  // Buffer unique : [times | translations | rotations], tout en float32 (aligné 4).
  const tBytes = n * 4;
  const trBytes = n * 12;
  const rBytes = n * 16;
  const buf = new ArrayBuffer(tBytes + trBytes + rBytes);
  new Float32Array(buf, 0, n).set(times);
  new Float32Array(buf, tBytes, n * 3).set(translations);
  new Float32Array(buf, tBytes + trBytes, n * 4).set(rotations);

  const minT = times.length ? times[0]! : 0;
  const maxT = times.length ? times[times.length - 1]! : 0;
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

/** Déclenche le téléchargement du glTF de l'animation caméra (three importé à la volée). */
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

/** Base neutre pour le bake d'export (les canaux animés priment ; fov par défaut si non animé). */
const EXPORT_BASE: SplatCamera = { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 }, fov: 45 };

/** Exporte une animation caméra v2 (F-curves) : bake en keyframes puis téléchargement glTF. */
export async function downloadAnimGltf(anim: CameraAnimV2, filename = 'review-camera.gltf'): Promise<void> {
  await downloadCameraGltf(bakeToKeyframes(anim, EXPORT_BASE), filename);
}
