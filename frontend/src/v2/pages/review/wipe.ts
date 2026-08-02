// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Géométrie du wipe de comparaison A/B (14.C, barre **rotative**) : la barre est une
 * droite passant par un centre C, orientée par `angleDeg` (0° = barre verticale,
 * sens horaire). Le média B est rogné au demi-plan « après » la barre. Calculs en
 * espace écran (px du conteneur) pour que l'angle affiché soit l'angle réel.
 */

export type Pt = [number, number];

/** Normale unitaire au wipe (direction de balayage). 0° → (1, 0) : balayage horizontal. */
export function wipeNormal(angleDeg: number): Pt {
  const a = (angleDeg * Math.PI) / 180;
  return [Math.cos(a), Math.sin(a)];
}

/** Centre de la barre en px : `pos` (0..1) balaie tout le conteneur le long de la normale. */
export function wipeCenter(pos: number, angleDeg: number, w: number, h: number): Pt {
  const [nx, ny] = wipeNormal(angleDeg);
  const extent = Math.abs(nx) * w + Math.abs(ny) * h;
  return [w / 2 + (pos - 0.5) * extent * nx, h / 2 + (pos - 0.5) * extent * ny];
}

/**
 * Polygone (fractions 0..1 du conteneur) du demi-plan « côté B » : clip du rectangle
 * par la droite du wipe (Sutherland–Hodgman). Vide si la barre est sortie du cadre.
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
    const cur = rect[i]!;
    const prev = rect[(i + rect.length - 1) % rect.length]!;
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

/** `clip-path: polygon(...)` CSS à partir des points (fractions 0..1). */
export function wipeClipPath(pos: number, angleDeg: number, w: number, h: number): string {
  const pts = wipeClipPoints(pos, angleDeg, w, h);
  if (pts.length === 0) return 'polygon(0 0, 0 0, 0 0)'; // rien de visible
  return `polygon(${pts.map(([x, y]) => `${(x * 100).toFixed(3)}% ${(y * 100).toFixed(3)}%`).join(', ')})`;
}

/** Position (0..1) du wipe correspondant à un point écran (projection sur la normale). */
export function wipePosFromPoint(x: number, y: number, angleDeg: number, w: number, h: number): number {
  const [nx, ny] = wipeNormal(angleDeg);
  const extent = Math.abs(nx) * w + Math.abs(ny) * h;
  if (extent <= 0) return 0.5;
  const d = (x - w / 2) * nx + (y - h / 2) * ny;
  return Math.min(1, Math.max(0, d / extent + 0.5));
}

/** Angle (deg) de la barre passant par C et pointant vers (x, y) — poignée de rotation
 * placée le long de la barre : direction barre = normale tournée de -90°. */
export function wipeAngleFromPoint(x: number, y: number, cx: number, cy: number): number {
  // La poignée est sur la barre, au-dessus du centre : direction (dx,dy) = (sin a, -cos a)·k
  const deg = (Math.atan2(y - cy, x - cx) * 180) / Math.PI + 90;
  // Normalise dans [-180, 180).
  const n = ((((deg + 180) % 360) + 360) % 360) - 180;
  // Aimante aux angles usuels (±3°).
  for (const snap of [-180, -135, -90, -45, 0, 45, 90, 135, 180]) {
    if (Math.abs(n - snap) <= 3) return snap === -180 ? 180 : snap;
  }
  return n;
}
