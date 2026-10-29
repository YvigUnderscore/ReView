// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';
import type { MediaResp } from '../reviewTypes';
import type { SplatEditProposal } from './splatEditPart';
import type { SplatViewer } from './useSplat';
import { applyMaskIndices, applySavedVolumes, fetchMaskIndices } from './editor/persistence/applyEdits';
import { hideSplats, restoreSplats } from './editor/operations/deleteSplats';
import {
  applySubsetOps,
  applySubsetOpsReversible,
  fetchSubsetOps,
  revertSubsetOps,
} from './editor/persistence/subsetOps';
import { disposeVolume, type VolumeRuntime } from './editor/volumes/cropVolume';

/**
 * Replays the cloud edits in **read mode**: orientation transform and flip, then crop volumes
 * (without wireframe), deletion mask and subset transforms.
 *
 * Two sources, never mixed for the transform:
 *  - the **media** edits, when no comment is being read: the editor manages them itself
 *    when it is mounted, hence the removal;
 *  - the **proposal** of a comment (lot 14), which takes over as soon as it exists, editor
 *    mounted or not. That is the whole point of the lot: a manager is the only person able to
 *    produce a proposal, and until now they were the only one refused the ability to show it.
 *    The editor suspends itself (`useEditorSuspend`) and gets its scene back intact on exit.
 *
 * The binaries of the proposal (mask, subset ops) are **undone on exit**: the mask restores
 * only the splats it had additionally masked, and the replayed ops are cancelled by their
 * snapshot. Without this, releasing the comment would leave the media's cloud holed and moved
 * until the next reload.
 */
export function useSavedSplatEdits(
  splat: SplatViewer,
  data: MediaResp,
  showEdit: boolean,
  proposal?: SplatEditProposal | null,
): void {
  const { applyTransform, setBaseFlip, ready, getSceneHandle } = splat;
  // Reading drives the cloud when there is no editor, or when a proposal is being read.
  const reading = !showEdit || proposal != null;
  const saved = proposal ?? data.splatEdits;

  const savedTransform = saved?.transform ?? null;
  const savedFlip = saved?.baseFlip ?? true;
  useEffect(() => {
    if (reading && ready) {
      applyTransform(savedTransform);
      setBaseFlip(savedFlip);
    }
  }, [reading, ready, applyTransform, savedTransform, setBaseFlip, savedFlip]);

  // Edits count for all viewers: they are replayed as they are.
  const savedVolumes = saved?.volumes ?? null;
  // Binaries: those of the proposal when it is read, those of the media otherwise. With the editor
  // mounted, the media's OWN binaries are already loaded by persistence: replaying them here would
  // mask twice and, above all, replay the subset ops twice, which are not idempotent.
  const maskUrl = proposal ? proposal.maskUrl : showEdit ? null : data.splatMaskUrl;
  const subsetUrl = proposal ? proposal.subsetUrl : showEdit ? null : data.splatSubsetUrl;
  const undoBinaries = proposal != null;
  useEffect(() => {
    if (!reading || !ready) return;
    const handle = getSceneHandle();
    if (!handle) return;
    let disposed = false;
    let created: VolumeRuntime[] = [];
    let hidden: ReturnType<typeof hideSplats> = null;
    let replayed: ReturnType<typeof applySubsetOpsReversible> = [];
    void (async () => {
      if (savedVolumes?.length) {
        created = await applySavedVolumes(handle, savedVolumes, false);
        if (disposed) created.forEach(disposeVolume);
      }
      if (maskUrl) {
        const indices = await fetchMaskIndices(maskUrl).catch(() => []);
        if (!disposed && indices.length) {
          // `hideSplats` ignores what is already masked and returns the original opacities of the rest:
          // exactly what must be given back on exit, without touching the media's mask.
          if (undoBinaries) hidden = hideSplats(handle, indices);
          else applyMaskIndices(handle, indices);
        }
      }
      if (subsetUrl) {
        const ops = await fetchSubsetOps(subsetUrl).catch(() => []);
        if (!disposed && ops.length) {
          if (undoBinaries) replayed = applySubsetOpsReversible(handle, ops);
          else applySubsetOps(handle, ops);
        }
      }
    })();
    return () => {
      disposed = true;
      created.forEach(disposeVolume);
      if (hidden) restoreSplats(handle, hidden);
      if (replayed.length) revertSubsetOps(handle, replayed);
    };
  }, [reading, ready, getSceneHandle, savedVolumes, maskUrl, subsetUrl, undoBinaries]);
}
