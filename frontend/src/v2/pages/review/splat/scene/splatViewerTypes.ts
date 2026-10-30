// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import type { Hotspot3D, SplatCamera, SplatTransform } from '../../reviewTypes';
import type { MarkerHandlers } from '../../three/objectHotspot';
import type { PipRect } from '../../viewer/pipWindow';
import type { RenderMode } from './renderModes';
import type { SplatStats } from './stats';
import type { SplatSceneCore } from './createScene';

/**
 * Contracts of the splat viewer, moved out of `useSplat` (line budget): the internal state of the
 * scene, the imperative handle passed to editing, and the API rendered to the page. `useSplat`
 * re-exports them, so the many callers keep importing from `../useSplat`.
 */
export type SplatScene = SplatSceneCore & {
  mesh: SplatMesh;
  pivot: THREE.Group;
  /** "Layout" camera of the PiP (layout mode, Phase 27): driven by the keyframe player. */
  layoutCam: THREE.PerspectiveCamera;
};

/**
 * Imperative handle to the splat's Three.js scene, exposed to the editing hooks (gizmos,
 * selection). The high-level React components do not touch it: only the `editor/` layer consumes
 * Three through this handle, keeping the scene / editing separation.
 */
export interface SplatSceneHandle {
  THREE: typeof import('three');
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  mesh: SplatMesh;
  /** Parent of the mesh carrying the import orientation flip (11.E): sibling splats
   *  (A/B comparison) must be added there to inherit the same axis convention. */
  pivot: THREE.Group;
  spark: SparkRenderer;
  dom: HTMLElement;
}

export interface SplatViewer {
  containerRef: React.RefObject<HTMLDivElement | null>;
  ready: boolean;
  loadError: boolean;
  /** Progress of the network download of the splat file (0..1) while it arrives, then null
   *  once the file is received (decoding and LOD in progress): 41.B light streaming. Feeds the
   *  loading bar so large scenes open quickly (GPU LOD is handled elsewhere). */
  progress: number | null;
  captureCamera: () => SplatCamera | undefined;
  restoreCamera: (state: unknown) => void;
  /** Point of interest on the surface **under the pointer** (client coordinates): set on click. */
  hotspotAtPointer: (clientX: number, clientY: number) => Hotspot3D | null;
  /** Numbered pins to project each frame (empty list = none). */
  showPoiPoints: (points: readonly Hotspot3D[]) => void;
  /** Arms (or disarms) the moving and designation of pins: composition only. */
  setPoiHandlers: (handlers: MarkerHandlers | null) => void;
  /** Rank of the highlighted pin (the composer row being edited), or null. */
  setPoiActive: (index: number | null) => void;
  /** Brings the camera back to a re-read point (number clicked in the thread). */
  focusPoi: (point: Hotspot3D) => boolean;
  /** Captures the current render as a JPEG thumbnail (data URL), resolved after the next render. */
  captureThumbnail: () => Promise<string | null>;
  /** Full-frame PNG of the current view (Export panel): `null` if the capture failed. */
  captureView: () => string | null;
  /** Applies a TRS transform to the splat: live preview of the gizmos and on loading. */
  applyTransform: (t: SplatTransform | null) => void;
  /** Import orientation flip (11.E): true (default) = .ply/.spz Y-down convention corrected
   *  (rotation of π about X on the parent group); false = file left as is. */
  setBaseFlip: (flip: boolean) => void;
  /** Toggles the display mode (splats / gaussian ellipses / points). */
  setRenderMode: (mode: RenderMode) => void;
  /** Mirrors the current selection in the "points" overlay (tint): no-op outside points mode. */
  reflectSelection: (selected: ReadonlySet<number>) => void;
  /** Mirrors a (un)masking of splats in the "points" overlay: no-op outside points mode. */
  reflectHidden: (indices: Iterable<number>, hidden: boolean) => void;
  /** Mirrors the carving of crop volumes in the "points" overlay (Phase 28): no-op otherwise. */
  reflectCropped: (indices: Iterable<number>) => void;
  /** Subscribes a panel to the render stats (FPS, splats, draw calls): measured only if subscribed. */
  subscribeStats: (cb: (stats: SplatStats) => void) => () => void;
  /** Subscribes a callback to each rendered frame (dt in seconds): camera animations (V5). */
  subscribeFrame: (cb: (dt: number) => void) => () => void;
  /** Disables (default) or restores the Spark culling (clipXY/maxPixelRadius): live setting. */
  setCullingOff: (off: boolean) => void;
  /** Fly in progress (right click + ZQSD): editing shortcuts must stay inert (11.G). */
  isFlying: () => boolean;
  /** Rect of the PiP window (CSS px, top-left origin): non-null means a second render pass of the
   *  layout camera into this rect (layout mode, Phase 27); null means PiP off. */
  setPipRect: (rect: PipRect | null) => void;
  /** Applies a pose (position/target/fov/roll) to the PiP's layout camera. */
  restorePipCamera: (state: unknown) => void;
  /** Imperative handle to the scene (for the editing hooks), or null if not ready yet. */
  getSceneHandle: () => SplatSceneHandle | null;
  /** Render canvas (auto-pauses the camera animation): satisfies `CameraController`. */
  getDom: () => HTMLElement | null;
}

/**
 * Interaction half of `SplatViewer`: the imperative handles that `useSplatHandles` derives from
 * the scene refs. Composed by `Pick`, with a single definition of each field.
 */
export type SplatHandles = Pick<
  SplatViewer,
  | 'captureThumbnail'
  | 'applyTransform'
  | 'setBaseFlip'
  | 'setRenderMode'
  | 'reflectSelection'
  | 'reflectHidden'
  | 'reflectCropped'
  | 'subscribeStats'
  | 'subscribeFrame'
  | 'setCullingOff'
  | 'isFlying'
  | 'setPipRect'
  | 'getSceneHandle'
  | 'getDom'
>;
