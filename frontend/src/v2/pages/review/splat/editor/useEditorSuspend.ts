// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, type RefObject } from 'react';
import type { SplatTransform } from '../../reviewTypes';
import type { SplatViewer } from '../useSplat';
import { detachVolume, reattachVolume, type VolumeRuntime } from './volumes/cropVolume';

/**
 * **Suspending the editor while a proposal is being read** (Phase 50, lot 14).
 *
 * A manager is the only person able to PRODUCE a cloud-edit proposal, so it is precisely to them
 * that one must be able to show one. Until lot 14, the replay cut out as soon as the editor was
 * mounted: two managers could not read each other's proposal, the "proposed scene" banner lit up
 * and the cloud did not move.
 *
 * The viewer has only one cloud: the answer is not to give up the replay, but to **yield control**.
 * While reading, the local edit is removed from the scene; on exit (Escape, or deselecting the
 * comment) it comes back as it was.
 *
 * What is suspended, and what is not:
 *  - the **transform** of the cloud and the **orientation flip** → yielded to the proposal, then
 *    re-applied identically on exit;
 *  - the local **crop volumes** → detached from the scene, never freed (their TRS stays readable,
 *    the next save intact), then re-attached;
 *  - the **locally deleted splats** → they REMAIN masked. A masked splat has lost its original
 *    opacity in the packed data (`hideSplats` writes 0): restoring it would require a snapshot the
 *    editor does not keep. The read proposal therefore masks whatever else it wants, and that is
 *    all one can honestly promise: what the author already deleted does not reappear for the
 *    duration of a reading.
 */
export function useEditorSuspend(opts: {
  /** Is the editor mounted? (outside the editor there is nothing to suspend) */
  enabled: boolean;
  /** Is a comment proposal being read? */
  suspended: boolean;
  splat: SplatViewer;
  /** Live crop volumes of the editor, by identifier. */
  runtimesRef: RefObject<Map<number, VolumeRuntime>>;
  /** Local TRS and flip, to be restored identically on exit. */
  transform: SplatTransform;
  baseFlip: boolean;
}): void {
  const { enabled, suspended, splat, runtimesRef, transform, baseFlip } = opts;
  const { ready, applyTransform, setBaseFlip, getSceneHandle } = splat;
  /**
   * The MOST RECENT local state, read at the moment control is yielded.
   *
   * A ref, not effect dependencies: putting `transform` in the dependencies would restart the
   * suspension on every edit step, and reading it in the effect closure would give the value from
   * one reading ago, the one from before if the author put their hand back on the gizmo while
   * reading someone else's proposal.
   */
  const local = useRef({ transform, baseFlip });
  useEffect(() => {
    local.current = { transform, baseFlip };
  }, [transform, baseFlip]);

  useEffect(() => {
    if (!enabled || !suspended || !ready) return;
    const handle = getSceneHandle();
    const detached = [...runtimesRef.current.values()];
    detached.forEach(detachVolume);
    return () => {
      if (handle) detached.forEach((runtime) => reattachVolume(handle, runtime));
      // The replay of the proposal wrote the TRS and the flip into the scene: rewrite them
      // with the local values, which the React state never lost.
      applyTransform(local.current.transform);
      setBaseFlip(local.current.baseFlip);
    };
  }, [enabled, suspended, ready, getSceneHandle, runtimesRef, applyTransform, setBaseFlip]);
}
