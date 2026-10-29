// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import { DEFAULT_REVIEW_ASPECT, reviewFrame } from '../frameRect';
import { resizeRendererCamera } from '../three/sceneConfig';
import { VIEWER_BACKDROP } from './thumbnail';

/**
 * View capture of spatial viewers (3D, splat) — the "Capture the view" button of the Export
 * panel.
 *
 * WHY. The button used to serve the THUMBNAIL: `toThumbnail` shrinks the canvas to 480 px wide
 * and encodes it as JPEG 0.72. That is the right template for a card thumbnail, not for an image
 * taken into a composition — hence a "very poor quality" capture. The capture now takes a
 * **dedicated** render:
 *
 * - **at the delivery frame**, not the container: `setViewOffset` extends the frame's view to the
 *   whole screen (full-space viewer, see `frameRect`); the capture clears this offset and thus
 *   renders exactly what the letterbox guide delimits — the annotated frame, without the bars;
 * - **at the delivery resolution rather than the window's**: at least `CAPTURE_MIN_WIDTH` wide
 *   (the render is supersampled when the window is smaller), capped by what the GPU can allocate;
 * - **as PNG**, lossless;
 * - **without the screen markers**: the floor grid is removed for the duration of the pose
 *   (`userData` marked `EXCLUDE_FROM_CAPTURE`). It is restored in a `finally` — a failed capture
 *   does not leave the scene without its grid.
 *
 * The logical part (`captureSize`, `hideCaptureMarkers`, `renderViewCapture`) knows neither
 * Three nor WebGL and is tested as is; `captureSceneView` is only the wiring.
 */

/** Target width: below it, the capture supersamples the screen render rather than stretching it. */
export const CAPTURE_MIN_WIDTH = 1920;

/** Safety ceiling: beyond it, allocating the drawing buffer becomes risky. */
export const CAPTURE_MAX_WIDTH = 4096;

export interface CaptureSize {
  width: number;
  height: number;
}

const usable = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * Resolution of a capture: the delivery frame's aspect, at least `CAPTURE_MIN_WIDTH` wide, capped
 * by `maxWidth` (GPU limit). Pure.
 */
export function captureSize(frameWidth: number, aspect: number, maxWidth?: number): CaptureSize {
  const a = usable(aspect) ? aspect : DEFAULT_REVIEW_ASPECT;
  const ceiling = usable(maxWidth) ? Math.min(maxWidth, CAPTURE_MAX_WIDTH) : CAPTURE_MAX_WIDTH;
  const cap = Math.max(1, Math.floor(ceiling));
  let width = Math.min(Math.max(usable(frameWidth) ? Math.round(frameWidth) : 0, CAPTURE_MIN_WIDTH), cap);
  let height = Math.max(1, Math.round(width / a));
  // Very tall format (aspect < 1): it is the HEIGHT that hits the ceiling, not the width.
  if (height > cap) {
    height = cap;
    width = Math.max(1, Math.round(cap * a));
  }
  return { width: Math.max(1, width), height };
}

/** `userData` key of a screen marker: visible in the viewer, absent from captures. */
export const EXCLUDE_FROM_CAPTURE = 'rvExcludeFromCapture';

export interface CaptureObject {
  visible: boolean;
  userData?: Record<string, unknown>;
}

export interface CaptureScene {
  traverse(visit: (o: CaptureObject) => void): void;
}

/**
 * Removes the marked markers from the scene for the duration of a pose. Returns what is needed to
 * put them back — to be run in a `finally`, otherwise a failed capture would leave the viewer
 * without its grid.
 */
export function hideCaptureMarkers(scene: CaptureScene): () => void {
  const hidden: CaptureObject[] = [];
  scene.traverse((o) => {
    if (o.visible && o.userData?.[EXCLUDE_FROM_CAPTURE] === true) {
      o.visible = false;
      hidden.push(o);
    }
  });
  return () => {
    for (const o of hidden) o.visible = true;
  };
}

export interface ViewCaptureDeps {
  /** Current drawing buffer (px) — measures the delivery frame as it is on screen. */
  buffer: { width: number; height: number };
  scene: CaptureScene;
  aspect: number;
  /** Maximum allocatable width (GPU limit) — fallback `CAPTURE_MAX_WIDTH`. */
  maxWidth?: number;
  /** Renders a frame at the requested resolution (renderer and camera re-set by the caller). */
  renderAt: (size: CaptureSize) => void;
  /** Encodes the rendered frame. */
  encode: () => string | null;
  /** Restores the screen render — ALWAYS run, whether the capture succeeded or not. */
  restore: () => void;
}

/**
 * Performs a capture: hides the markers, renders at the wanted resolution, encodes, then restores
 * the scene and the screen render. Testable without WebGL.
 */
export function renderViewCapture(deps: ViewCaptureDeps): string | null {
  const aspect = usable(deps.aspect) ? deps.aspect : DEFAULT_REVIEW_ASPECT;
  const frame = reviewFrame(aspect, deps.buffer.width, deps.buffer.height);
  const size = captureSize(frame.width, aspect, deps.maxWidth);
  const showMarkers = hideCaptureMarkers(deps.scene);
  try {
    deps.renderAt(size);
    return deps.encode();
  } catch {
    // Buffer not allocated, tainted canvas, lost context: no image, but the scene is intact.
    return null;
  } finally {
    showMarkers();
    deps.restore();
  }
}

/**
 * PNG of the rendered frame, flattened onto the viewer background: the splat renderer uses
 * `alpha: true`, and a transparent capture would not show what the viewer is looking at.
 */
export function toCapturePng(canvas: HTMLCanvasElement): string | null {
  const flat = document.createElement('canvas');
  flat.width = canvas.width;
  flat.height = canvas.height;
  const ctx = flat.getContext('2d');
  if (!ctx || !flat.width || !flat.height) return null;
  ctx.fillStyle = VIEWER_BACKDROP;
  ctx.fillRect(0, 0, flat.width, flat.height);
  ctx.drawImage(canvas, 0, 0);
  const url = flat.toDataURL('image/png');
  return url.startsWith('data:image/png') ? url : null;
}

/** What a spatial viewer must provide to capture its view — satisfied by both scenes. */
export interface ViewCaptureScene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
}

/**
 * Captures the view of a mounted scene. `onRestored` requests a screen frame again when the viewer
 * renders on demand: restoring goes back through `setSize`, which empties the drawing buffer.
 */
export function captureSceneView(
  s: ViewCaptureScene | null | undefined,
  aspect: number,
  onRestored?: () => void,
): string | null {
  if (!s) return null;
  const { renderer, scene, camera } = s;
  const canvas = renderer.domElement;
  // An aberrant aspect would make `resizeRendererCamera` render without framing on return: we
  // sanitise it once, and the restoration sees exactly the aspect used for the capture.
  const a = usable(aspect) ? aspect : DEFAULT_REVIEW_ASPECT;
  // Logical size of the screen render, read BEFORE touching the renderer: it is used to put it
  // back without measuring the DOM (the canvas is stretched by CSS, not sized by it).
  const ratio = renderer.getPixelRatio();
  const screen = { w: Math.round(canvas.width / ratio), h: Math.round(canvas.height / ratio) };
  return renderViewCapture({
    buffer: { width: canvas.width, height: canvas.height },
    scene,
    aspect: a,
    maxWidth: renderer.capabilities?.maxTextureSize,
    renderAt: ({ width, height }) => {
      // `setSize` multiplies by the pixel ratio: we neutralise it to get exactly the requested
      // resolution, and restore it in `restore`.
      renderer.setPixelRatio(1);
      renderer.setSize(width, height, false);
      // No more enlarged sub-view: the capture renders the delivery frame, not the container.
      if (camera.view?.enabled) camera.clearViewOffset();
      camera.aspect = a;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    },
    encode: () => toCapturePng(canvas),
    restore: () => {
      renderer.setPixelRatio(ratio);
      resizeRendererCamera(renderer, camera, screen.w, screen.h, a);
      renderer.render(scene, camera); // `setSize` emptied the buffer: redraw straight away
      onRestored?.();
    },
  });
}

/**
 * Capture ready to wire to the Export panel button. Accesses are lazy: the scene only exists after
 * Three's asynchronous mount, and the delivery aspect may change.
 */
export function viewCapturer(
  getScene: () => ViewCaptureScene | null | undefined,
  getAspect: () => number,
  onRestored?: () => void,
): () => string | null {
  return () => captureSceneView(getScene(), getAspect(), onRestored);
}
