// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { useCameraShortcuts } from '../../camera/useCameraShortcuts';
import type { MediaResp } from '../../reviewTypes';
import { importCameraFile } from '../../three/importCameraAbc';
import type { Annotations } from '../../useAnnotations';
import { frameCameraToSphere } from '../../viewer/frameCamera';
import { useFrameShortcuts } from '../../viewer/useFrameShortcuts';
import { meshBounds, selectionBounds } from '../editor/selection/bounds';
import type { PresentationState } from '../presentation/usePresentation';
import type { SplatViewer } from '../useSplat';
import { useSplatCommands } from '../useSplatCommands';
import { frameCameraToMesh } from './frameCamera';
import { useT } from '@/v2/i18n';

export interface SplatInput {
  /** Frames the selection if present (editing), otherwise the visible splat: F key. */
  frameView: () => void;
  /** Restores the original view (automatic framing of the mesh): H key. */
  homeView: () => void;
  /**
   * Attaches, or detaches, the camera animation of the comment being written, and says whether it
   * already is: the transport button lights this state, otherwise only a toast announced it.
   */
  attachLayout: { toggle: () => void; attached: boolean };
  /** Imports a camera animation (.abc) and plays it immediately. */
  importLayout: (file: File) => void;
}

/**
 * Pointer and keyboard wiring of the splat block: camera transport, F/H framing, Ctrl+K palette,
 * and the two camera-animation actions (attach to the comment, import a file). Extracted from
 * `SplatReview` (line budget): the component composes, it no longer wires.
 *
 * Point-of-interest placement is no longer here: it follows the rail tool (`poi/usePoiPlacement`,
 * called by `SplatReview`), exactly as in the 3D viewer.
 *
 * The mounting order is the one from before the extraction (camera transport before F/H framing):
 * these hooks register keyboard listeners on `window`, and one does not assume that the order of
 * registration is irrelevant.
 */
export function useSplatInput({
  splat,
  data,
  ann,
  pres,
  selected,
  showEdit,
  canPresent,
  stageMode,
}: {
  splat: SplatViewer;
  data: MediaResp;
  /** Annotations: camera animation attached to the comment, and the one of the comment being read. */
  ann: Annotations;
  pres: PresentationState;
  /** Editor selection: F frames it when it is not empty. */
  selected: ReadonlySet<number>;
  /** Editor mounted: it already handles F/H (selection), the viewer shortcuts stay inert. */
  showEdit: boolean;
  /** Manager: can place keyframes and edit the staging. */
  canPresent: boolean;
  /** "Staging" mode active: Ctrl+Z drives the animation's history. */
  stageMode: boolean;
}): SplatInput {
  const t = useT();
  const { ready, getSceneHandle } = splat;

  // Camera transport shortcuts: Space, K, ←/→, Home/End; Ctrl+Z of the animation in Layout mode.
  useCameraShortcuts({
    anim: pres.anim,
    active: true,
    editable: canPresent,
    undoActive: stageMode,
    fps: data.fps ?? 24,
  });

  // Layout mode: replays the camera animation attached to the selected comment.
  const { setAnim: animSetAnim, play: animPlay } = pres.anim;
  const viewedCameraAnim = ann.viewedCameraAnim;
  useEffect(() => {
    if (viewedCameraAnim) {
      animSetAnim(viewedCameraAnim);
      animPlay();
    }
  }, [viewedCameraAnim, animSetAnim, animPlay]);

  // Attach / detach: the button carries the state, so it must also know how to undo it. And nothing
  // goes out silently any more: a press without an animation says so instead of doing nothing.
  const toggleAttach = useCallback(() => {
    if (ann.cameraAnim) {
      ann.setCameraAnim(null);
      toast.info(t('review.camera.detached'));
      return;
    }
    if (!pres.anim.hasAnimation) {
      toast.warning(t('review.camera.nothingToAttach'));
      return;
    }
    ann.setCameraAnim(pres.anim.anim);
    toast.success(t('review.camera.attached'));
  }, [pres.anim, ann, t]);

  const importLayout = useCallback(
    (file: File) => {
      void importCameraFile(file)
        .then((animData) => {
          if (!animData) {
            toast.error(t('review.camera.none'));
            return;
          }
          pres.anim.setAnim(animData);
          pres.anim.play();
          toast.success(t('review.camera.imported'));
        })
        .catch(() => toast.error(t('review.camera.importFailed')));
    },
    [pres.anim, t],
  );

  // F/H framing, active for **everyone** (including post-publish review): F frames the selection
  // if present (editing), otherwise the visible splat; H restores the original view.
  const frameView = useCallback(() => {
    const handle = getSceneHandle();
    if (!handle) return;
    const bounds = (selected.size ? selectionBounds(handle, selected) : null) ?? meshBounds(handle);
    if (bounds) frameCameraToSphere(handle.camera, handle.controls, bounds.center, bounds.radius);
  }, [getSceneHandle, selected]);
  const homeView = useCallback(() => {
    const handle = getSceneHandle();
    if (handle) frameCameraToMesh(handle.THREE, handle.mesh, handle.camera, handle.controls);
  }, [getSceneHandle]);

  // F/H viewer shortcuts (post-publish). In editing, the editor already handles F/H (selection).
  useFrameShortcuts({
    active: !showEdit && ready,
    isFlying: splat.isFlying,
    onFrame: frameView,
    onHome: homeView,
  });

  // Ctrl+K palette (B3): the viewer's actions, without one more button.
  useSplatCommands({
    pres,
    frameView,
    homeView,
    canPresent,
    hasPresentation: !!data.splatPresentation,
  });

  // The action and its state travel together: the transport button must say what is attached.
  const attachLayout = { toggle: toggleAttach, attached: ann.cameraAnim != null };
  return { frameView, homeView, attachLayout, importLayout };
}
