// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SdfVolumeData } from '@/v2/pages/review/reviewTypes';
import { t } from '@/v2/i18n';
import type { SplatSceneHandle } from '../../useSplat';
import { hideSplats } from '../operations/deleteSplats';
import { applyVolumeData, createVolume, type VolumeRuntime } from '../volumes/cropVolume';
import { decodeMask } from './mask';

/**
 * Applies a splat's persisted edits (10.G) when the viewer loads, for **all** viewers.
 * The saved crop volumes and deletion mask are applied to the display; the original file stays
 * intact. The editor reuses the same building blocks to restart from the saved state.
 */

/** Recreates the persisted volumes in the scene (read-only, shown as wireframe). */
export async function applySavedVolumes(
  handle: SplatSceneHandle,
  volumes: SdfVolumeData[],
  showWire: boolean,
): Promise<VolumeRuntime[]> {
  const runtimes: VolumeRuntime[] = [];
  for (const data of volumes) {
    const runtime = await createVolume(handle, data.shape, data.mode, showWire);
    applyVolumeData(runtime, data);
    runtimes.push(runtime);
  }
  return runtimes;
}

/** Downloads and decodes the deletion mask (binary bitset to masked indices). */
export async function fetchMaskIndices(url: string): Promise<number[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(t('splat.maskUnavailable', { status: res.status }));
  return decodeMask(new Uint8Array(await res.arrayBuffer()));
}

/** Applies the mask (opacity 0) to the indices; returns the set actually masked. */
export function applyMaskIndices(handle: SplatSceneHandle, indices: number[]): Set<number> {
  hideSplats(handle, indices);
  return new Set(indices);
}
