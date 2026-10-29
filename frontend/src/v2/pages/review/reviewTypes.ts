// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Media, ModelSource, ReviewRequestRule } from '../../types/api';
import type { ReviewAssignee } from '../../types/entities';
import { normalizeAnim } from './camera/channels/model';
import { readSplatEditPart, type SplatEditPartData } from './splat/splatEditPart';
import type { CameraAnimV2 } from './camera/channels/model';

/** Shared review types and utilities (split 10.C2). */

export interface Transform {
  yaw: number;
  pitch: number;
  roll: number;
  scale: number;
}
export const DEFAULT_TRANSFORM: Transform = { yaw: 0, pitch: 0, roll: 0, scale: 1 };

/**
 * TRS transform of a splat (10.G): position, quaternion and scale, exactly what the 3D gizmos
 * (TransformControls) produce, without euler conversion. Persisted in `metadata.splatEdits.transform`,
 * applied to the SplatMesh (which derives from THREE.Object3D).
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

/** Serialised SDF crop volume (box/sphere, carve/isolate): mirror of the backend Zod. */
export interface SdfVolumeData {
  shape: 'box' | 'sphere';
  mode: 'delete' | 'isolate';
  position: [number, number, number];
  quaternion: [number, number, number, number];
  scale: [number, number, number];
}

/** Non-destructive edits of a splat (10.G): `metadata.splatEdits` (the deletion mask, binary, lives apart
 * in MinIO — see `splatMaskUrl`). */
export interface SplatEdits {
  transform: SplatTransform | null;
  volumes: SdfVolumeData[];
  /** Import orientation flip (11.E): true/absent = Y-down convention straightened;
   *  false = file left as is (the editor's "Flip" button). */
  baseFlip?: boolean;
}

/** Media cache update after saving splat edits (composition 10.E2). */
export type SplatEditsPatch = Partial<
  Pick<
    MediaResp,
    | 'splatEdits'
    | 'splatMaskUrl'
    | 'splatMaskCount'
    | 'splatSubsetUrl'
    | 'splatSubsetCount'
    | 'splatPresentation'
    | 'trim'
    | 'trimProxyReady'
  >
>;

/**
 * 3D painter stroke (10.G-V9): a polyline painted on the surface of the splat, stored in the **object
 * space** of the SplatMesh in the `Comment.annotation` array (like the hotspots): it follows the media's
 * transform and stays visible for everyone.
 */
export interface SplatPaintStroke {
  type: 'splat-paint';
  /** Flattened xyz coordinates (object space). */
  points: number[];
  color: string;
  /**
   * Thickness **in screen pixels**: constant whatever the zoom (Phase 50, batch 8). It used to be relative
   * to the scene size, hence in world units: the stroke grew as one approached and vanished when one backed
   * off, whereas the options bar announced "px".
   */
  width: number;
  /**
   * Approximate normal of the stroke in object space (the direction from which it was painted): used to
   * fade it when passing behind the surface. Absent on earlier strokes: they remain fully visible.
   */
  normal?: [number, number, number];
}

/**
 * Camera animation attached to a comment (layout mode): instead of drawing, the user creates or attaches a
 * camera animation (F-curves v2), replayed when the comment is selected. Stored as a part
 * `{ type:'camera-anim', version:2, loop, channels }` in `Comment.annotation`.
 */
export type SplatLayoutAnim = CameraAnimV2;

/**
 * Splits the parts of a comment annotation: camera animation (layout mode) and 2D shapes. The painter's
 * strokes (`splat-paint`, V9), the camera animation and the points of interest (`poi`, like the inherited
 * `hotspot`) are excluded from the shapes: each has its own rendering. The animation is **normalised to v2**
 * (old v1 annotations are migrated on reading).
 *
 * The points of interest are read through `poi/poiPoints.readPoiPoints`, which unifies the `poi` part and
 * the single `hotspot` from before Phase 50: they no longer go through here.
 */
export function splitAnnotationParts(annotation: unknown): {
  shapes: unknown[];
  cameraAnim: SplatLayoutAnim | null;
  /** 3D scene proposal attached to the comment (46.D): replayed on its selection. */
  sceneOverride: unknown;
  /**
   * Cloud edit proposal attached to the comment (Phase 50, batch 14): twin of `sceneOverride` for the
   * splat, replayed on selection and never written into the media. Both binaries (mask, ops) are listed
   * by their key: `resolveSplatEditProposal` resolves them among the attachments of the carrying comment.
   */
  splatEdit: SplatEditPartData | null;
  /** Video range in→out (34.A): the annotation remains visible throughout the range. */
  range: { inFrame: number; outFrame: number } | null;
} {
  if (!Array.isArray(annotation))
    return { shapes: [], cameraAnim: null, range: null, sceneOverride: null, splatEdit: null };
  const parts = annotation as Array<{ type?: string; inFrame?: number; outFrame?: number }>;
  const anim = parts.find((x) => x?.type === 'camera-anim');
  const rangePart = parts.find((x) => x?.type === 'range');
  const scenePart = parts.find((x) => x?.type === 'scene-override') as { override?: unknown } | undefined;
  const shapes = parts.filter(
    (x) =>
      x &&
      x.type !== 'hotspot' &&
      x.type !== 'poi' &&
      x.type !== 'splat-paint' &&
      x.type !== 'camera-anim' &&
      x.type !== 'range' &&
      x.type !== 'scene-override' &&
      x.type !== 'splat-edit',
  );
  const range =
    rangePart &&
    typeof rangePart.inFrame === 'number' &&
    typeof rangePart.outFrame === 'number' &&
    rangePart.outFrame > rangePart.inFrame
      ? { inFrame: rangePart.inFrame, outFrame: rangePart.outFrame }
      : null;
  return {
    shapes,
    cameraAnim: normalizeAnim(anim),
    range,
    sceneOverride: scenePart?.override ?? null,
    splatEdit: readSplatEditPart(parts),
  };
}

/** Easing of a v1 camera animation segment (kept for migration and glTF import/export). */
export type CameraEasing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';

/** v1 camera animation keyframe pose (time in ms): legacy format, migrated to v2 on reading. */
export interface SplatCameraKeyframe {
  t: number;
  pose: SplatCamera;
  easing: CameraEasing;
}

/**
 * Persisted presentation of a splat (10.G-V5): `metadata.splatPresentation`, written by the manager and
 * **replayed for everyone** on opening; viewers modify live without persisting. Mirror of the backend Zod
 * (media-splat.routes). The camera animation is in v2 format (F-curves): v1 presentations are migrated on
 * reading (`normalizeAnim`).
 */
export interface SplatPresentation {
  camera?: SplatCamera;
  dof?: { focalDistance: number; apertureAngle: number };
  reveal?: { type: 'fade' | 'sweep' | 'dissolve'; durationMs: number };
  lodDefault?: 'auto' | 'on' | 'off' | 'streaming';
  cameraAnim?: CameraAnimV2;
  /** Default lighting / HDRI of the 3D viewer (Phase 29): replayed for everyone, temporary viewer tweak. */
  lighting?: LightingConfig;
  /** Shared camera bookmarks (39.D): recallable named views (shortcuts 1-9), replayed for everyone. */
  bookmarks?: CameraBookmark[];
}

/** Named and shared camera view of the 3D/splat viewer (39.D): persisted in the presentation. */
export interface CameraBookmark {
  label?: string;
  camera: SplatCamera;
}

/** HDRI lighting settings of the 3D viewer (Phase 29). `hdriId` references the instance library. */
export interface LightingConfig {
  hdriId?: string;
  /** Tone-mapping exposure (0–10, 1 = neutral). */
  exposure: number;
  /** Rotation of the environment around Y, in degrees. */
  rotationDeg: number;
  /** Show the HDRI as background (otherwise transparent background, lighting only). */
  showBackground: boolean;
  /** Invisible ground receiving the key light's cast shadows (39.F): non-destructive. */
  groundShadow: boolean;
}

export const DEFAULT_LIGHTING: LightingConfig = {
  exposure: 1,
  rotationDeg: 0,
  showBackground: false,
  groundShadow: false,
};

/** Response of GET /api/media/:id (review viewer). */
export interface MediaResp {
  /** Name of the file delivered by ShotGrid, when `media.originalName` carries the site code. */
  sourceFilename: string | null;
  media: Media;
  /** Carrying project (mentions, deep links). */
  projectId: number;
  url: string;
  thumbnailUrl: string | null;
  proxyUrl: string | null;
  glbUrl: string | null;
  startFrame: number;
  /** 3D conversion provenance (39.A, `usd` block since 45.C): displayed in the technical sheet. */
  modelSource: ModelSource | null;
  /** Reason for a processing failure (45.C): missing USD asset, tooling absent… */
  processingError: string | null;
  /** Scene "ReView override" (46.D): staging replayed on opening, for everyone. */
  usdOverride: unknown;
  fps: number | null;
  /** Broadcast frequency of the live room (Hz), admin-adjustable per media type (33.B). */
  liveSyncHz: number;
  /** Non-destructive edits recorded for a splat (transform + volumes): 10.G. */
  splatEdits: SplatEdits | null;
  /** Presigned URL of the binary deletion mask (bitset), or null. */
  splatMaskUrl: string | null;
  /** Number of splats masked by the deletion mask. */
  splatMaskCount: number;
  /** Presigned URL of the subset transform ops (binary ops), or null: Phase 28. */
  splatSubsetUrl: string | null;
  /** Number of recorded subset transform ops. */
  splatSubsetCount: number;
  /** Persisted presentation (camera/DoF/reveal/LOD/animation): 10.G-V5, replayed for everyone. */
  splatPresentation: SplatPresentation | null;
  /** Default HDRI lighting of the project (39.F): fallback when the media has none of its own. */
  projectDefaultLighting: LightingConfig | null;
  /** OCIO colour management of the project (39.B): display/view intent, shown as a badge. */
  projectColor: { configId?: string; display?: string; view?: string } | null;
  /**
   * Ratio of the review frame, inherited from the delivery resolution (studio → project → sequence → shot).
   * It is a DEFAULT: an aspect already frozen in `splatPresentation` takes precedence. The full rule and its
   * why are in `reviewAspect.ts`.
   */
  deliveryAspect: number;
  /**
   * HISTORICAL cut (10.G-V10, cutting removed in Phase 50): frame bounds of a media cut before its removal.
   * Nothing sets them any more; the review uses them to say what it plays (technical sheet, Export panel)
   * and to rule out the HLS ladder, which ignores the cut.
   */
  trim: { inFrame: number; outFrame: number } | null;
  trimProxyReady: boolean;
  /** Adaptive HLS (Phase 23): available renditions, played via the `/hls/master.m3u8` proxy. */
  hls: { renditions: { height: number; width: number; videoBitrateK: number }[] } | null;
  /** Timeline thumbnail sprite (~1 thumbnail every 3 s, a single tiled JPEG). */
  timelineSprite: {
    intervalSec: number;
    count: number;
    cols: number;
    rows: number;
    tileW: number;
    tileH: number;
  } | null;
  timelineSpriteUrl: string | null;
  /** 2D review reference images (Phase 24, multi-item): persisted and shared,
   *  pinned to the canvas (coordinates as fractions of the base image). */
  references: ReviewReferenceItem[];
  /** Who this VERSION's review is entrusted to, and what each one must look at there. */
  reviewers: ReviewAssignee[];
  /** What the project requires of an instruction: the screen refuses before the round trip. */
  reviewRequest: ReviewRequestRule;
  /**
   * What THIS caller is allowed to write, computed by the server (`lib/versionPermissions`). The screen no
   * longer copies the rule: it reads it. That removes both the dead "Save" button and the silent 403 that
   * followed it.
   */
  permissions: MediaPermissions;
}

/** Write rights of the caller on this media, as the server decides them. */
export interface MediaPermissions {
  /**
   * TRS transform of the version: author of the version or project manager, and version not published. It
   * is the only editing tool of the "Clean up" mode of a 3D model. Otherwise the whole mode disappears,
   * rather than offering a refused save.
   */
  editTransform: boolean;
}

/** Reference image pinned to the canvas of the image review (frozen, linked to a comment). */
export interface ReviewReferenceItem {
  id: number;
  url: string;
  x: number;
  y: number;
  width: number;
  /** Carrying comment: displayed only when selected (null = historical). */
  commentId: number | null;
}

export interface Hotspot3D {
  position: string;
  normal: string;
  /** 'object': coordinates in the SplatMesh's object space (follows the transform, 10.G-V10).
   *  Absent: historical hotspot in world space (model-viewer manages its own space). */
  space?: 'object';
}

/** Camera view of a Gaussian Splat (Spark viewer): free position and target, cf. cameraState. */
export interface SplatCamera {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  fov?: number;
  aspect?: number;
  /** Tilt (roll) around the view axis, in radians (layout mode): 0 or absent = level horizon. */
  roll?: number;
  /** Spark depth of field (live sync + comments): absent = left as is. */
  apertureAngle?: number;
  focalDistance?: number;
}

/** Class of the media zone (frame common to the video, image and 3D viewers). */
export const VIEWER_ZONE =
  'relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-border bg-black/40';

/**
 * Same zone, in video full screen: it covers the whole pane (itself `position: relative`) instead of
 * staying in the flow. Classes are rewritten entirely rather than added to `VIEWER_ZONE`: `absolute` and
 * `relative` ended up together there, and the Tailwind sheet places `.relative` after `.absolute`. The
 * zone therefore stayed in the flow, at a height dictated by the box measured before full screen, and the
 * video kept its size.
 */
export const VIEWER_ZONE_FULLSCREEN =
  'absolute inset-0 flex items-center justify-center overflow-hidden bg-black';

/** Media zone of a video player, depending on whether immersive full screen is active. */
export const viewerZone = (fullscreen: boolean) => (fullscreen ? VIEWER_ZONE_FULLSCREEN : VIEWER_ZONE);

/** HH:MM:SS:FF timecode from a frame index and the fps. */
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

/** Duration mm:ss (timeline). */
export function formatTime(s: number): string {
  const m = Math.floor(s / 60),
    sec = Math.floor(s % 60);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** Usable GLB: successful conversion, or original already in glTF format. */
export function resolveGlbSrc(data: MediaResp | null): string | null {
  if (!data) return null;
  return data.glbUrl ?? (/\.(glb|gltf)(\?|$)/i.test(data.url) ? data.url : null);
}

/** First comparable media (same type) of a version: A/B comparison, video and image. */
export function findCompareMedia(
  media: Array<{ id: number; kind: string }>,
  excludeId: number,
  kind: string,
): number | null {
  return media.find((m) => m.kind === kind && m.id !== excludeId)?.id ?? null;
}

/** Shifts the video by `delta` frames (pauses for a precise step). */
export function stepVideoFrame(video: HTMLVideoElement | null, fps: number, delta: number): void {
  if (!video) return;
  video.pause();
  video.currentTime = Math.max(0, video.currentTime + delta / fps);
}

/**
 * Seek coalescer for scrubbing: writes `currentTime` only when the previous seek has finished (`seeked`),
 * retaining only the **last** requested position. Without it, scrubbing floods the player with seeks (each
 * aborts the previous one) and hls.js ends up in an inconsistent state after release. A simple click
 * (single seek) does not bug, that one.
 */
export function createSeekCoalescer(video: HTMLVideoElement, beforeSeek?: () => void) {
  let pending: number | null = null;
  const apply = (t: number) => {
    beforeSeek?.();
    video.currentTime = t;
  };
  const onSeeked = () => {
    if (pending != null) {
      const t = pending;
      pending = null;
      apply(t);
    }
  };
  video.addEventListener('seeked', onSeeked);
  return {
    seek(t: number) {
      if (video.seeking) pending = t;
      else apply(t);
    },
    dispose() {
      pending = null;
      video.removeEventListener('seeked', onSeeked);
    },
  };
}

// Playback start pending data (only one at a time per video element).
const pendingPlay = new WeakMap<HTMLVideoElement, () => void>();

/** Cancels a pending playback start (the user paused in the meantime). */
export function cancelPendingPlay(video: HTMLVideoElement): void {
  pendingPlay.get(video)?.();
  pendingPlay.delete(video);
}

/**
 * Starts playback only when the **frame** is decodable at the current position. After an HLS rendition
 * change while paused, the video buffer may have a hole at the current position while the audio is loaded:
 * a direct `play()` would give sound over a frozen frame. We first force an in-place micro-seek (hls.js
 * reloads the segment or skips the hole, the equivalent of the manual "next frame then read back"), then
 * wait for `canplay` before starting.
 */
export function safePlay(video: HTMLVideoElement): void {
  cancelPendingPlay(video);
  video.playbackRate = 1;
  if (video.readyState >= 3 /* HAVE_FUTURE_DATA */) {
    void video.play();
    return;
  }
  video.currentTime = Math.max(0, video.currentTime - 0.001);
  const onReady = () => {
    pendingPlay.delete(video);
    video.removeEventListener('canplay', onReady);
    void video.play();
  };
  pendingPlay.set(video, () => video.removeEventListener('canplay', onReady));
  video.addEventListener('canplay', onReady);
}
