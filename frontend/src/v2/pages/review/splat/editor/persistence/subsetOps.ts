// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SplatSceneHandle } from '../../useSplat';
import {
  applySubsetDelta,
  restoreSubset,
  snapshotSubset,
  type SubsetSnapshot,
} from '../operations/transformSplats';
import { t } from '../../../../../i18n';

/**
 * Transformations de sous-ensembles de splats persistées (Phase 28) — encodage binaire pur
 * (testable sans WebGL). Chaque op = la matrice **delta** (locale au mesh, autour du barycentre,
 * telle que produite par le gizmo) + les indices des splats concernés. Les ops sont rejouées
 * dans l'ordre au chargement (`PackedSplats.setSplat`), pour tous — le fichier original reste
 * intact. Stocké dans MinIO (`metadata.splatSubsetKey`), transporté en base64 dans le JSON d'API.
 */

/** Une transformation de sous-ensemble : matrice 4×4 (16 éléments column-major) + indices. */
export interface SubsetOp {
  delta: number[];
  indices: number[];
}

const VERSION = 1;

/** Encode la liste d'ops : uint32 version + uint32 nb d'ops, puis par op 16×float64 + uint32 n + n×uint32. */
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
      view.setFloat64(o, op.delta[i] ?? (i % 5 === 0 ? 1 : 0), true); // défaut identité
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

/** Décode la liste d'ops — lève si le format est inconnu ou tronqué. */
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

/** Télécharge et décode les transformations de sous-ensembles persistées. */
export async function fetchSubsetOps(url: string): Promise<SubsetOp[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(t('splat.opsUnavailable', { status: res.status }));
  return decodeSubsetOps(new Uint8Array(await res.arrayBuffer()));
}

/** Rejoue les ops dans l'ordre sur les données paquées (au chargement — éditeur comme spectateur). */
export function applySubsetOps(handle: SplatSceneHandle, ops: readonly SubsetOp[]): void {
  applySubsetOpsReversible(handle, ops);
}

/**
 * Même rejeu, mais en rendant de quoi le DÉFAIRE (Phase 50, lot 14).
 *
 * Les ops d'un chargement de média sont définitives : elles décrivent le nuage tel qu'il est
 * livré. Celles d'une **proposition de commentaire** ne le sont pas — on les relâche en quittant
 * le commentaire, et sans instantané le nuage resterait déplacé jusqu'au prochain rechargement.
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

/** Défait un rejeu, du dernier au premier : deux ops peuvent avoir touché le même splat. */
export function revertSubsetOps(handle: SplatSceneHandle, snaps: readonly SubsetSnapshot[]): void {
  for (let i = snaps.length - 1; i >= 0; i--) restoreSubset(handle, snaps[i]);
}
