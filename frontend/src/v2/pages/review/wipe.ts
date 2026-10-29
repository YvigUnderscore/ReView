// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Geometry of the A/B comparison wipe (14.C, **rotating** bar): the bar is a line through a
 * centre C, oriented by `angleDeg` (0° = vertical bar, clockwise). Media B is clipped to the
 * half-plane "after" the bar. Computations are done in screen space (container px) so that the
 * displayed angle is the real angle.
 */

export type Pt = [number, number];

/** Unit normal to the wipe (sweep direction). 0° → (1, 0): horizontal sweep. */
export function wipeNormal(angleDeg: number): Pt {
  const a = (angleDeg * Math.PI) / 180;
  return [Math.cos(a), Math.sin(a)];
}

/** Centre of the bar in px: `pos` (0..1) sweeps the whole container along the normal. */
export function wipeCenter(pos: number, angleDeg: number, w: number, h: number): Pt {
  const [nx, ny] = wipeNormal(angleDeg);
  const extent = Math.abs(nx) * w + Math.abs(ny) * h;
  return [w / 2 + (pos - 0.5) * extent * nx, h / 2 + (pos - 0.5) * extent * ny];
}

/**
 * Polygon (fractions 0..1 of the container) of the "B side" half-plane: the rectangle clipped by
 * the wipe line (Sutherland–Hodgman). Empty if the bar has left the frame.
 */
export function wipeClipPoints(pos: number, angleDeg: number, w: number, h: number): Pt[] {
  if (w <= 0 || h <= 0) return [];
  const [nx, ny] = wipeNormal(angleDeg);
  const [cx, cy] = wipeCenter(pos, angleDeg, w, h);
  const inside = (p: Pt) => (p[0] - cx) * nx + (p[1] - cy) * ny >= 0;
  const intersect = (a: Pt, b: Pt): Pt => {
    const da = (a[0] - cx) * nx + (a[1] - cy) * ny;
    const db = (b[0] - cx) * nx + (b[1] - cy) * ny;
    const t = da / (da - db);
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  };
  const rect: Pt[] = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ];
  const out: Pt[] = [];
  for (let i = 0; i < rect.length; i++) {
    const cur = rect[i];
    const prev = rect[(i + rect.length - 1) % rect.length];
    const curIn = inside(cur);
    const prevIn = inside(prev);
    if (curIn) {
      if (!prevIn) out.push(intersect(prev, cur));
      out.push(cur);
    } else if (prevIn) {
      out.push(intersect(prev, cur));
    }
  }
  return out.map(([x, y]) => [x / w, y / h]);
}

/** CSS `clip-path: polygon(...)` built from the points (fractions 0..1). */
export function wipeClipPath(pos: number, angleDeg: number, w: number, h: number): string {
  const pts = wipeClipPoints(pos, angleDeg, w, h);
  if (pts.length === 0) return 'polygon(0 0, 0 0, 0 0)'; // nothing visible
  return `polygon(${pts.map(([x, y]) => `${(x * 100).toFixed(3)}% ${(y * 100).toFixed(3)}%`).join(', ')})`;
}

/** Wipe position (0..1) matching a screen point (projection onto the normal). */
export function wipePosFromPoint(x: number, y: number, angleDeg: number, w: number, h: number): number {
  const [nx, ny] = wipeNormal(angleDeg);
  const extent = Math.abs(nx) * w + Math.abs(ny) * h;
  if (extent <= 0) return 0.5;
  const d = (x - w / 2) * nx + (y - h / 2) * ny;
  return Math.min(1, Math.max(0, d / extent + 0.5));
}

/** Angle (deg) of the bar passing through C and pointing towards (x, y) — rotation handle placed
 * along the bar: bar direction = normal rotated by -90°. */
export function wipeAngleFromPoint(x: number, y: number, cx: number, cy: number): number {
  // The handle is on the bar, above the centre: direction (dx,dy) = (sin a, -cos a)·k
  const deg = (Math.atan2(y - cy, x - cx) * 180) / Math.PI + 90;
  // Normalise to [-180, 180).
  const n = ((((deg + 180) % 360) + 360) % 360) - 180;
  // Snap to common angles (±3°).
  for (const snap of [-180, -135, -90, -45, 0, 45, 90, 135, 180]) {
    if (Math.abs(n - snap) <= 3) return snap === -180 ? 180 : snap;
  }
  return n;
}
