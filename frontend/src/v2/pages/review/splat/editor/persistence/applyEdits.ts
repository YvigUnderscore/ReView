// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SdfVolumeData } from '../../../reviewTypes';
import { t } from '../../../../../i18n';
import type { SplatSceneHandle } from '../../useSplat';
import { hideSplats } from '../operations/deleteSplats';
import { applyVolumeData, createVolume, type VolumeRuntime } from '../volumes/cropVolume';
import { decodeMask } from './mask';

/**
 * Application des éditions persistées d'un splat (10.G) — au chargement du viewer, pour
 * **tous** les spectateurs : les volumes de crop et le masque de suppression enregistrés
 * s'appliquent à l'affichage (le fichier original reste intact). L'éditeur réutilise les mêmes
 * briques pour repartir de l'état enregistré.
 */

/** Recrée les volumes persistés dans la scène (filaire masqué en lecture seule). */
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

/** Télécharge et décode le masque de suppression (bitset binaire → indices masqués). */
export async function fetchMaskIndices(url: string): Promise<number[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(t('splat.maskUnavailable', { status: res.status }));
  return decodeMask(new Uint8Array(await res.arrayBuffer()));
}

/** Applique le masque (opacité 0) aux indices — renvoie l'ensemble effectivement masqué. */
export function applyMaskIndices(handle: SplatSceneHandle, indices: number[]): Set<number> {
  hideSplats(handle, indices);
  return new Set(indices);
}
