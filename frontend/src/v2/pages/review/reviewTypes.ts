import type { Media } from '../../types/api';
import { normalizeAnim } from './camera/channels/model';
import type { CameraAnimV2 } from './camera/channels/model';

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
  /** Flip d'orientation à l'import (11.E) : true/absent = convention Y-down redressée ;
   *  false = fichier laissé tel quel (bouton « Retourner » de l'éditeur). */
  baseFlip?: boolean;
}

/** Mise à jour du cache média après enregistrement des éditions splat (composition 10.E2). */
export type SplatEditsPatch = Partial<
  Pick<
    MediaResp,
    'splatEdits' | 'splatMaskUrl' | 'splatMaskCount' | 'splatPresentation' | 'trim' | 'trimProxyReady'
  >
>;

/**
 * Trait du painter 3D (10.G-V9) : polyligne peinte sur la surface du splat, stockée en
 * **espace-objet** du SplatMesh dans le tableau `Comment.annotation` (comme les hotspots) —
 * elle suit la transformation du média et reste visible pour tous.
 */
export interface SplatPaintStroke {
  type: 'splat-paint';
  /** Coordonnées xyz aplaties (espace objet). */
  points: number[];
  color: string;
  /** Épaisseur relative (1 à 5). */
  width: number;
}

/**
 * Animation caméra jointe à un commentaire (mode layout) : au lieu de dessiner, l'utilisateur
 * crée/joint une animation caméra (F-curves v2), rejouée quand le commentaire est sélectionné.
 * Stockée comme part `{ type:'camera-anim', version:2, loop, channels }` dans `Comment.annotation`.
 */
export type SplatLayoutAnim = CameraAnimV2;

/**
 * Sépare les parties d'une annotation de commentaire : hotspot 3D, animation caméra (mode
 * layout) et formes 2D — les traits du painter (`splat-paint`, V9) et l'anim caméra sont exclus
 * des formes (rendus dédiés). L'animation est **normalisée en v2** (les anciennes annotations
 * v1 sont migrées à la lecture).
 */
export function splitAnnotationParts(annotation: unknown): {
  hotspot: Hotspot3D | null;
  shapes: unknown[];
  cameraAnim: SplatLayoutAnim | null;
} {
  if (!Array.isArray(annotation)) return { hotspot: null, shapes: [], cameraAnim: null };
  const parts = annotation as Array<{
    type?: string;
    position?: string;
    normal?: string;
    space?: 'object';
  }>;
  const hs = parts.find((x) => x?.type === 'hotspot');
  const anim = parts.find((x) => x?.type === 'camera-anim');
  const shapes = parts.filter(
    (x) => x && x.type !== 'hotspot' && x.type !== 'splat-paint' && x.type !== 'camera-anim',
  );
  return {
    hotspot: hs?.position && hs.normal ? { position: hs.position, normal: hs.normal, space: hs.space } : null,
    shapes,
    cameraAnim: normalizeAnim(anim),
  };
}

/** Easing d'un segment d'animation caméra v1 (conservé pour la migration + import/export glTF). */
export type CameraEasing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';

/** Pose keyframe d'animation caméra v1 (temps en ms) — format hérité, migré en v2 à la lecture. */
export interface SplatCameraKeyframe {
  t: number;
  pose: SplatCamera;
  easing: CameraEasing;
}

/**
 * Présentation persistée d'un splat (10.G-V5) : `metadata.splatPresentation` — écrite par le
 * gestionnaire, **rejouée pour tous** à l'ouverture ; les spectateurs modifient en live sans
 * persister. Miroir du Zod backend (media-splat.routes). L'animation caméra est au format v2
 * (F-curves) — les présentations v1 sont migrées à la lecture (`normalizeAnim`).
 */
export interface SplatPresentation {
  camera?: SplatCamera;
  dof?: { focalDistance: number; apertureAngle: number };
  reveal?: { type: 'fade' | 'sweep' | 'dissolve'; durationMs: number };
  lodDefault?: 'auto' | 'on' | 'off' | 'streaming';
  cameraAnim?: CameraAnimV2;
}

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
  /** Présentation persistée (caméra/DoF/reveal/LOD/animation) — 10.G-V5, rejouée pour tous. */
  splatPresentation: SplatPresentation | null;
  /** Trim vidéo non-destructif (10.G-V10) : bornes en frames, proxy trimé prêt ou en cours. */
  trim: { inFrame: number; outFrame: number } | null;
  trimProxyReady: boolean;
  /** HLS adaptatif (Phase 23) : renditions disponibles → lecture via le proxy `/hls/master.m3u8`. */
  hls: { renditions: { height: number; width: number; videoBitrateK: number }[] } | null;
}

export interface Hotspot3D {
  position: string;
  normal: string;
  /** 'object' : coordonnées en espace-objet du SplatMesh (suit la transformation, 10.G-V10).
   *  Absent : hotspot historique en espace monde (model-viewer gère son propre espace). */
  space?: 'object';
}

/** Vue caméra d'un Gaussian Splat (viewer Spark) — position/cible libres, cf. cameraState. */
export interface SplatCamera {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  fov?: number;
  aspect?: number;
  /** Tilt (roll) autour de l'axe de vue, en radians (mode layout) — 0/absent = horizon droit. */
  roll?: number;
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

/** Premier média vidéo comparable d'une version (comparaison A/B, backlog P2). */
export function findCompareVideo(
  media: Array<{ id: number; kind: string }>,
  excludeId: number,
): number | null {
  return media.find((m) => m.kind === 'VIDEO' && m.id !== excludeId)?.id ?? null;
}

/** Décale la vidéo de `delta` frames (met en pause pour un pas précis). */
export function stepVideoFrame(video: HTMLVideoElement | null, fps: number, delta: number): void {
  if (!video) return;
  video.pause();
  video.currentTime = Math.max(0, video.currentTime + delta / fps);
}
