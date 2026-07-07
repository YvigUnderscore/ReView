import type { Media } from '../../types/api';

/** Types et utilitaires partagés de la review (découpage 10.C2). */

export interface Transform {
  yaw: number;
  pitch: number;
  roll: number;
  scale: number;
}
export const DEFAULT_TRANSFORM: Transform = { yaw: 0, pitch: 0, roll: 0, scale: 1 };

/**
 * Transformation TRS d'un splat (10.G) — position/quaternion/échelle, exactement ce que les
 * gizmos 3D (TransformControls) produisent, sans conversion euler. Persistée dans
 * `metadata.splatEdits.transform`, appliquée au SplatMesh (dérive de THREE.Object3D).
 */
export interface SplatTransform {
  position: [number, number, number];
  quaternion: [number, number, number, number];
  scale: [number, number, number];
}
export const IDENTITY_SPLAT_TRANSFORM: SplatTransform = {
  position: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
  scale: [1, 1, 1],
};

/** Volume de crop SDF sérialisé (boîte/sphère, creuser/isoler) — miroir du Zod backend. */
export interface SdfVolumeData {
  shape: 'box' | 'sphere';
  mode: 'delete' | 'isolate';
  position: [number, number, number];
  quaternion: [number, number, number, number];
  scale: [number, number, number];
}

/** Éditions non-destructives d'un splat (10.G) : `metadata.splatEdits` (le masque de
 * suppression, binaire, vit à part dans MinIO — cf. `splatMaskUrl`). */
export interface SplatEdits {
  transform: SplatTransform | null;
  volumes: SdfVolumeData[];
}

/** Mise à jour du cache média après enregistrement des éditions splat (composition 10.E2). */
export type SplatEditsPatch = Partial<Pick<MediaResp, 'splatEdits' | 'splatMaskUrl' | 'splatMaskCount'>>;

/** Réponse de GET /api/media/:id (viewer review). */
export interface MediaResp {
  media: Media;
  url: string;
  thumbnailUrl: string | null;
  proxyUrl: string | null;
  glbUrl: string | null;
  startFrame: number;
  fps: number | null;
  /** Éditions non-destructives enregistrées pour un splat (transform + volumes) — 10.G. */
  splatEdits: SplatEdits | null;
  /** URL présignée du masque de suppression binaire (bitset), ou null. */
  splatMaskUrl: string | null;
  /** Nombre de splats masqués par le masque de suppression. */
  splatMaskCount: number;
}

export interface Hotspot3D {
  position: string;
  normal: string;
}

// Type minimal des méthodes model-viewer utilisées (caméra + raycast + animations).
export interface ModelViewerEl extends HTMLElement {
  getBoundingClientRect: () => DOMRect;
  positionAndNormalFromPoint?: (
    x: number,
    y: number,
  ) => { position: { toString(): string }; normal: { toString(): string } } | null;
  getCameraOrbit?: () => { theta: number; phi: number; radius: number };
  getCameraTarget?: () => { x: number; y: number; z: number };
  getFieldOfView?: () => number;
  cameraOrbit?: string;
  cameraTarget?: string;
  fieldOfView?: string;
  availableAnimations?: string[];
  loaded?: boolean;
  play?: (opts?: { repetitions?: number }) => void;
  pause?: () => void;
}

export interface ModelCamera {
  orbit: { theta: number; phi: number; radius: number };
  target?: { x: number; y: number; z: number };
  fov?: number;
  aspect?: number;
}

/** Vue caméra d'un Gaussian Splat (viewer Spark) — position/cible libres, cf. cameraState. */
export interface SplatCamera {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  fov?: number;
  aspect?: number;
}

/** Classe de la zone média (cadre commun aux viewers vidéo/image/3D). */
export const VIEWER_ZONE =
  'relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-border bg-black/40';

/** Timecode HH:MM:SS:FF à partir d'un index de frame et du fps. */
export function tcFromFrame(frame: number, fps: number): string {
  const f = Math.max(0, Math.round(frame));
  const totalSec = Math.floor(f / fps);
  const ff = f % Math.round(fps);
  const ss = totalSec % 60,
    mm = Math.floor(totalSec / 60) % 60,
    hh = Math.floor(totalSec / 3600);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(hh)}:${p(mm)}:${p(ss)}:${p(ff)}`;
}

/** Durée mm:ss (timeline). */
export function formatTime(s: number): string {
  const m = Math.floor(s / 60),
    sec = Math.floor(s % 60);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** GLB exploitable : conversion réussie, ou original déjà au format glTF. */
export function resolveGlbSrc(data: MediaResp | null): string | null {
  if (!data) return null;
  return data.glbUrl ?? (/\.(glb|gltf)(\?|$)/i.test(data.url) ? data.url : null);
}

/** Décale la vidéo de `delta` frames (met en pause pour un pas précis). */
export function stepVideoFrame(video: HTMLVideoElement | null, fps: number, delta: number): void {
  if (!video) return;
  video.pause();
  video.currentTime = Math.max(0, video.currentTime + delta / fps);
}
