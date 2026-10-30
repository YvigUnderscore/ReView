// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import { frameViewOffset } from '../frameRect';

/**
 * Pure helpers of the common Three base (Phase 15, V0) — testable without a WebGL context.
 * `createModelScene` (impure, instantiates the renderer) builds on them.
 */

/** Framing safety margin (the object fills ~1/margin of the most constrained field). */
export const FRAME_MARGIN = 1.25;

/**
 * Color management of the renderer (V0/V4): ColorManagement enabled, sRGB output, ACES Filmic tone
 * mapping (rendering close to a 3D engine; ACEScg → sRGB handled at display). Kept separate from
 * `createModelScene` so it can be unit-tested (fake renderer + THREE constants).
 */
export function configureRenderer(three: typeof import('three'), renderer: THREE.WebGLRenderer): void {
  three.ColorManagement.enabled = true;
  renderer.outputColorSpace = three.SRGBColorSpace;
  renderer.toneMapping = three.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
}

/**
 * Resizes renderer + camera to (w, h). No-op if a dimension is zero (container not yet measured).
 * Returns `true` if applied.
 *
 * With `frameAspect` (Phase 25 — full-space viewer): the camera keeps the aspect of the **delivery
 * frame** (identical framing/fov for everyone) and the view is extended to the whole container via
 * `setViewOffset` — the letterbox guide (ReviewFrame) materializes the frame on screen.
 */
export function resizeRendererCamera(
  renderer: Pick<THREE.WebGLRenderer, 'setSize'>,
  camera: THREE.PerspectiveCamera,
  w: number,
  h: number,
  frameAspect?: number,
): boolean {
  if (w <= 0 || h <= 0) return false;
  renderer.setSize(w, h, false);
  if (Number.isFinite(frameAspect) && (frameAspect as number) > 0) {
    camera.aspect = frameAspect as number;
    const v = frameViewOffset(camera.aspect, w, h);
    camera.setViewOffset(v.fullWidth, v.fullHeight, v.x, v.y, v.width, v.height);
  } else {
    if (camera.view?.enabled) camera.clearViewOffset();
    camera.aspect = w / h;
  }
  camera.updateProjectionMatrix();
  return true;
}

/**
 * Camera distance to frame a sphere of radius `radius` in the most constrained of the two fields
 * (vertical/horizontal) — consistent with the splat auto-framing (`frameCamera`). Returns 0 if the
 * inputs are degenerate.
 */
export function fitDistance(radius: number, vFovDeg: number, aspect: number): number {
  if (!Number.isFinite(radius) || radius <= 0 || vFovDeg <= 0) return 0;
  const vFov = (vFovDeg * Math.PI) / 180;
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * a);
  return (radius / Math.sin(Math.min(vFov, hFov) / 2)) * FRAME_MARGIN;
}
