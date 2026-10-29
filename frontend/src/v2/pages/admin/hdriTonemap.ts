// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Tonemaps a linear HDR buffer (float RGBA) to displayable 8-bit RGBA:
 * nearest-neighbour sampling to the target size + Reinhard (v/(1+v)) + gamma 2.2.
 * Pure (testable) — used by the admin's HDRI thumbnail preview (Phase 22).
 */
export function tonemapToRgba(
  data: ArrayLike<number>,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor((y / dh) * sh));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.floor((x / dw) * sw));
      const si = (sy * sw + sx) * 4;
      const di = (y * dw + x) * 4;
      for (let c = 0; c < 3; c++) {
        const v = Math.max(0, Number(data[si + c] ?? 0));
        out[di + c] = Math.round(Math.pow(v / (1 + v), 1 / 2.2) * 255);
      }
      out[di + 3] = 255;
    }
  }
  return out;
}
