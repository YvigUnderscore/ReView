// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Fixed-aspect review frame (Phase 15/16, V6). The 3D/splat viewport renders into a
 * **letterboxed** frame of constant aspect (taken from the presentation camera), rather than
 * being stretched to the screen size: the staging (framing, focal length, DoF) and the
 * normalized 2D annotations stay aligned whatever the window size.
 *
 * Pure helper (testable): the largest rectangle of aspect `aspect` (width/height) that fits in
 * `containerW × containerH`, centered. Returns the rect in pixels (left/top/width/height).
 */
export interface FrameRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Default aspect of the review frame when no presentation camera sets it (16:9). */
export const DEFAULT_REVIEW_ASPECT = 16 / 9;

/**
 * `camera.setViewOffset` parameters extending the view of the fixed frame to the whole container
 * (Phase 25, full-space viewer): the camera keeps the aspect/fov of the delivery frame
 * (`fullWidth × fullHeight` = guide), and renders the whole container as an enlarged, centered
 * sub-view (negative offsets). The guide's content stays identical for all screens.
 */
export function frameViewOffset(
  aspect: number,
  containerW: number,
  containerH: number,
): { fullWidth: number; fullHeight: number; x: number; y: number; width: number; height: number } {
  const guide = reviewFrame(aspect, containerW, containerH);
  return {
    fullWidth: guide.width,
    fullHeight: guide.height,
    // `|| 0`: normalizes the -0 produced by negating a flush edge (readability of the tests).
    x: -guide.left || 0,
    y: -guide.top || 0,
    width: containerW,
    height: containerH,
  };
}

/** Annotation coordinate outside the delivery frame (normalized space 0..1). */
const out = (v: number | undefined) => v != null && (v < 0 || v > 1);

/**
 * `true` if an annotation overflows the delivery frame. Drawing outside the frame is allowed
 * (Phase 25) but flagged to the author, since viewers on a narrower screen may not see all of it.
 */
export function shapesOutsideFrame(
  shapes: Array<{
    type: string;
    pts?: number[][];
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    cx?: number;
    cy?: number;
    rx?: number;
    ry?: number;
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
  }>,
): boolean {
  return shapes.some((s) => {
    if (s.type === 'path') return (s.pts ?? []).some(([x, y]) => out(x) || out(y));
    if (s.type === 'rect')
      return out(s.x) || out(s.y) || out((s.x ?? 0) + (s.w ?? 0)) || out((s.y ?? 0) + (s.h ?? 0));
    if (s.type === 'ellipse')
      return (
        out((s.cx ?? 0) - (s.rx ?? 0)) ||
        out((s.cx ?? 0) + (s.rx ?? 0)) ||
        out((s.cy ?? 0) - (s.ry ?? 0)) ||
        out((s.cy ?? 0) + (s.ry ?? 0))
      );
    if (s.type === 'arrow') return out(s.x1) || out(s.y1) || out(s.x2) || out(s.y2);
    return out(s.x) || out(s.y); // text: anchor
  });
}

export function reviewFrame(aspect: number, containerW: number, containerH: number): FrameRect {
  // Defensive fallback: invalid dimensions/aspect → fill the container (neutral behaviour).
  if (!Number.isFinite(aspect) || aspect <= 0 || containerW <= 0 || containerH <= 0) {
    return { left: 0, top: 0, width: Math.max(0, containerW), height: Math.max(0, containerH) };
  }
  const containerAspect = containerW / containerH;
  let width: number;
  let height: number;
  if (containerAspect > aspect) {
    // Container wider than the frame → vertical bands, full height.
    height = containerH;
    width = height * aspect;
  } else {
    // Container narrower/taller → horizontal bands, full width.
    width = containerW;
    height = width / aspect;
  }
  return {
    left: (containerW - width) / 2,
    top: (containerH - height) / 2,
    width,
    height,
  };
}
