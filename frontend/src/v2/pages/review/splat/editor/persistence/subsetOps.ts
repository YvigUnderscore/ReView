// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SplatSceneHandle } from '../../useSplat';
import {
  applySubsetDelta,
  restoreSubset,
  snapshotSubset,
  type SubsetSnapshot,
} from '../operations/transformSplats';
import { t } from '@/v2/i18n';

/**
 * Persisted transformations of splat subsets (Phase 28), pure binary encoding
 * (testable without WebGL). Each op is the **delta** matrix (local to the mesh, around the
 * barycentre, as produced by the gizmo) plus the indices of the affected splats. Ops are replayed
 * in order on load (`PackedSplats.setSplat`), for everyone; the original file stays
 * intact. Stored in MinIO (`metadata.splatSubsetKey`), transported as base64 in the API JSON.
 */

/** A subset transformation: 4x4 matrix (16 elements, column-major) plus indices. */
export interface SubsetOp {
  delta: number[];
  indices: number[];
}

const VERSION = 1;

/** Encodes the op list: uint32 version + uint32 op count, then per op 16×float64 + uint32 n + n×uint32. */
export function encodeSubsetOps(ops: readonly SubsetOp[]): Uint8Array {
  const size = 8 + ops.reduce((acc, op) => acc + 16 * 8 + 4 + op.indices.length * 4, 0);
  const buf = new ArrayBuffer(size);
  const view = new DataView(buf);
  let o = 0;
  view.setUint32(o, VERSION, true);
  o += 4;
  view.setUint32(o, ops.length, true);
  o += 4;
  for (const op of ops) {
    for (let i = 0; i < 16; i++) {
      view.setFloat64(o, op.delta[i] ?? (i % 5 === 0 ? 1 : 0), true); // identity by default
      o += 8;
    }
    view.setUint32(o, op.indices.length, true);
    o += 4;
    for (const idx of op.indices) {
      view.setUint32(o, idx, true);
      o += 4;
    }
  }
  return new Uint8Array(buf);
}

/** Decodes the op list; throws if the format is unknown or truncated. */
export function decodeSubsetOps(bytes: Uint8Array): SubsetOp[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 8 || view.getUint32(0, true) !== VERSION)
    throw new Error('Format de transformations inconnu');
  const count = view.getUint32(4, true);
  const ops: SubsetOp[] = [];
  let o = 8;
  for (let k = 0; k < count; k++) {
    if (o + 16 * 8 + 4 > bytes.byteLength) throw new Error(t('splat.transformTruncated'));
    const delta: number[] = [];
    for (let i = 0; i < 16; i++) {
      delta.push(view.getFloat64(o, true));
      o += 8;
    }
    const n = view.getUint32(o, true);
    o += 4;
    if (o + n * 4 > bytes.byteLength) throw new Error(t('splat.transformTruncated'));
    const indices: number[] = [];
    for (let i = 0; i < n; i++) {
      indices.push(view.getUint32(o, true));
      o += 4;
    }
    ops.push({ delta, indices });
  }
  return ops;
}

/** Downloads and decodes the persisted subset transformations. */
export async function fetchSubsetOps(url: string): Promise<SubsetOp[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(t('splat.opsUnavailable', { status: res.status }));
  return decodeSubsetOps(new Uint8Array(await res.arrayBuffer()));
}

/** Replays the ops in order on the packed data (on load, for editor and viewer alike). */
export function applySubsetOps(handle: SplatSceneHandle, ops: readonly SubsetOp[]): void {
  applySubsetOpsReversible(handle, ops);
}

/**
 * Same replay, but also returns what is needed to UNDO it (Phase 50, lot 14).
 *
 * The ops of a media load are final: they describe the cloud as delivered. Those of a
 * **comment proposal** are not: they are released when leaving the comment, and without a
 * snapshot the cloud would stay moved until the next reload.
 */
export function applySubsetOpsReversible(
  handle: SplatSceneHandle,
  ops: readonly SubsetOp[],
): SubsetSnapshot[] {
  const m = new handle.THREE.Matrix4();
  const snaps: SubsetSnapshot[] = [];
  for (const op of ops) {
    const snap = snapshotSubset(handle, op.indices);
    if (!snap) continue;
    applySubsetDelta(handle, snap, m.fromArray(op.delta));
    snaps.push(snap);
  }
  return snaps;
}

/** Undoes a replay, from last to first: two ops may have touched the same splat. */
export function revertSubsetOps(handle: SplatSceneHandle, snaps: readonly SubsetSnapshot[]): void {
  for (let i = snaps.length - 1; i >= 0; i--) restoreSubset(handle, snaps[i]);
}
