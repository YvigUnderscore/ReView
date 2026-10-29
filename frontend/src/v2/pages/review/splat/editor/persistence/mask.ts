// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Deletion mask of a splat (10.G), pure binary encoding (testable without WebGL).
 * A bitset: bit `i` is 1 if the splat at index `i` is masked. Stored as-is in
 * MinIO (`metadata.splatMaskKey`), transported as base64 in the API JSON.
 */

/** Encodes a set of masked indices as a bitset (size = ⌈(max+1)/8⌉ bytes). */
export function encodeMask(indices: Iterable<number>): Uint8Array {
  let max = -1;
  const list: number[] = [];
  for (const i of indices) {
    if (!Number.isInteger(i) || i < 0) continue;
    list.push(i);
    if (i > max) max = i;
  }
  if (max < 0) return new Uint8Array(0);
  const bytes = new Uint8Array(Math.ceil((max + 1) / 8));
  for (const i of list) bytes[i >> 3] = bytes[i >> 3] | (1 << (i & 7));
  return bytes;
}

/** Decodes a bitset into a list of masked indices. */
export function decodeMask(bytes: Uint8Array): number[] {
  const out: number[] = [];
  for (let b = 0; b < bytes.length; b++) {
    const byte = bytes[b];
    if (byte === 0) continue;
    for (let bit = 0; bit < 8; bit++) if (byte & (1 << bit)) out.push((b << 3) | bit);
  }
  return out;
}

/** Uint8Array to base64 (chunked, to avoid the stack overflow of String.fromCharCode). */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

/** base64 to Uint8Array. */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
