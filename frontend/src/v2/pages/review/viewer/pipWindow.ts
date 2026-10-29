// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import { renderWithoutHelpers } from './sceneHelpers';

/** PiP rectangle in CSS pixels, origin at the container's **top-left** (DOM coords). */
export interface PipRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Minimum PiP window width (CSS px) — below it the content becomes unreadable. */
export const PIP_MIN_WIDTH = 120;
const DEFAULT_FRAC = 0.28;
const MARGIN = 10;

/** Default position: bottom-right corner, width = 28 % of the container, height from the aspect ratio. */
export function defaultPipRect(cw: number, ch: number, aspect: number): PipRect {
  const w = Math.round(cw * DEFAULT_FRAC);
  const rect = clampPipRect({ x: cw, y: ch, w, h: Math.round(w / aspect) }, cw, ch, aspect);
  return { ...rect, x: Math.max(0, cw - rect.w - MARGIN), y: Math.max(0, ch - rect.h - MARGIN) };
}

/**
 * Constrains a PiP rect to the container: width clamped (readable minimum, container maximum),
 * height locked to the aspect ratio (window = camera frame), position brought back inside.
 */
export function clampPipRect(rect: PipRect, cw: number, ch: number, aspect: number): PipRect {
  let w = Math.min(Math.max(rect.w, PIP_MIN_WIDTH), Math.max(cw - 2 * MARGIN, PIP_MIN_WIDTH));
  // Height follows the aspect; if it overflows the container, the width is reduced accordingly.
  if (Math.round(w / aspect) > ch - 2 * MARGIN && ch > 2 * MARGIN)
    w = Math.max(Math.round((ch - 2 * MARGIN) * aspect), 1);
  const h = Math.max(Math.round(w / aspect), 1);
  const x = Math.min(Math.max(rect.x, 0), Math.max(cw - w, 0));
  const y = Math.min(Math.max(rect.y, 0), Math.max(ch - h, 0));
  return { x, y, w: Math.round(w), h };
}

/** Converts a DOM rect (top-left origin) to a GL rect (bottom-left origin) for the scissor. */
export function toGlRect(rect: PipRect, ch: number): PipRect {
  return { x: rect.x, y: ch - rect.y - rect.h, w: rect.w, h: rect.h };
}

/**
 * Second render pass of the PiP (layout camera view): scissor + viewport on the window rect,
 * only depth cleared (the background stays the main render), then restoration of the full-frame
 * viewport. Shared by the 3D and splat viewers (Phase 27 — lot F).
 *
 * The PiP is **the image of the plan**, not a second working view: the camera rig helper objects
 * are removed from it (`viewer/sceneHelpers`), otherwise the wireframe frustum and the target
 * marker — rigid relative to the plan camera — would draw a motionless picture there.
 *
 * `depthFrom`: the camera whose near/far the PiP takes over. Framing (`F`, "real size", import)
 * resets these planes to the scene scale for the free camera only; the PiP camera used to keep
 * the ones from loading, and truncated the plan view on a very large scene.
 *
 * Args:
 *     renderer: WebGL renderer to draw with.
 *     scene: Scene to render.
 *     camera: Layout camera, whose aspect is set from `rect`.
 *     rect: PiP rectangle in DOM pixels.
 *     cw: Container width in pixels.
 *     ch: Container height in pixels.
 *     depthFrom: Optional near/far planes to copy onto `camera`.
 */
export function renderPipPass(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  rect: PipRect,
  cw: number,
  ch: number,
  depthFrom?: { near: number; far: number },
): void {
  if (rect.w <= 0 || rect.h <= 0 || cw <= 0 || ch <= 0) return;
  const gl = toGlRect(rect, ch);
  camera.aspect = rect.w / rect.h;
  if (depthFrom) {
    camera.near = depthFrom.near;
    camera.far = depthFrom.far;
  }
  camera.updateProjectionMatrix();
  renderer.setScissorTest(true);
  renderer.setScissor(gl.x, gl.y, gl.w, gl.h);
  renderer.setViewport(gl.x, gl.y, gl.w, gl.h);
  renderer.autoClear = false;
  renderer.clearDepth(); // scissor active → only clears the depth inside the PiP
  renderWithoutHelpers(() => renderer.render(scene, camera));
  renderer.autoClear = true;
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, cw, ch);
}
