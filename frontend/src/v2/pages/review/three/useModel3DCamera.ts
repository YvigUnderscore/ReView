// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import type { MediaResp, SplatEditsPatch, SplatPresentation } from '../reviewTypes';
import type { Annotations } from '../useAnnotations';
import { useCameraAnim } from '../camera/useCameraAnim';
import { orbitPresetV2 } from '../camera/channels/orbitPreset';
import { confirmReplaceAnim } from '../camera/confirmReplaceAnim';
import { emptyAnim, hasAnimation, normalizeAnim } from '../camera/channels/model';
import { cameraPoseFromView } from '../camera/cameraPose';
import { useCameraPresentation } from '../camera/useCameraPresentation';
import { importCameraFile } from './importCameraAbc';
import type { Model3DThreeState } from './useModel3DThree';
import { useT } from '@/v2/i18n';

/**
 * Camera controller of the Three 3D viewer (Phase 16/17): keyframe reader (driven by the layout
 * camera in PiP, otherwise by the main camera), replay of the **persisted presentation** on opening
 * (for everyone), layout mode, and recording of the presentation by the manager (`splatPresentation`
 * field reused, camera-generic). Extracted from the former `Model3DCameraBar` so that the
 * `Model3DReview` orchestrator stays under the budget.
 */
export function useModel3DCamera(
  model3d: Model3DThreeState,
  data: MediaResp,
  canManage: boolean,
  onSaved: (patch: SplatEditsPatch) => void,
  ann: Annotations,
) {
  const t = useT();
  const anim = useCameraAnim(model3d.layoutController);
  const { busy, persist, remove } = useCameraPresentation(data.media.id, onSaved);
  const { setAnim, play } = anim;
  const { ready, restoreCamera, setFov, setRoll } = model3d;

  // Layout mode: replays the camera animation attached to the selected comment.
  const viewedCameraAnim = ann.viewedCameraAnim;
  useEffect(() => {
    if (viewedCameraAnim) {
      setAnim(viewedCameraAnim);
      play();
    }
  }, [viewedCameraAnim, setAnim, play]);

  // Attach / detach: the button carries the state, so it must also know how to undo it. And nothing
  // goes silent anymore — a press without an animation says so instead of doing nothing.
  const toggleAttach = useCallback(() => {
    if (ann.cameraAnim) {
      ann.setCameraAnim(null);
      toast.info(t('review.camera.detached'));
      return;
    }
    if (!hasAnimation(anim.anim)) {
      toast.warning(t('review.camera.nothingToAttach'));
      return;
    }
    ann.setCameraAnim(anim.anim);
    toast.success(t('review.camera.attached'));
  }, [anim.anim, ann, t]);

  const importGltf = useCallback(
    (file: File) => {
      void importCameraFile(file)
        .then((animData) => {
          if (!animData) {
            toast.error(t('review.camera.none'));
            return;
          }
          setAnim(animData);
          play();
          toast.success(t('review.camera.imported'));
        })
        .catch(() => toast.error(t('review.camera.importFailed')));
    },
    [setAnim, play, t],
  );

  // Replay of the persisted presentation on opening (once the scene is ready), for everyone.
  const appliedRef = useRef(false);
  const pres = data.splatPresentation;
  useEffect(() => {
    if (!ready || appliedRef.current || !pres) return;
    appliedRef.current = true;
    if (pres.camera) {
      restoreCamera(pres.camera);
      if (pres.camera.fov != null) setFov(pres.camera.fov);
      if (pres.camera.roll != null) setRoll(pres.camera.roll);
    }
    const anim2 = normalizeAnim(pres.cameraAnim);
    if (anim2) {
      setAnim(anim2);
      play();
    }
  }, [ready, pres, restoreCamera, setFov, setRoll, setAnim, play]);

  const applyOrbitPreset = useCallback(() => {
    const view = model3d.captureCamera();
    if (!view) return;
    const run = () => {
      anim.setAnim(orbitPresetV2(view));
      anim.play();
    };
    if (anim.hasAnimation) confirmReplaceAnim(run);
    else run();
  }, [model3d, anim]);

  const save = useCallback(async () => {
    const view = model3d.captureCamera();
    // Preserves the other persisted fields (including the HDRI lighting, Phase 29).
    const presentation: SplatPresentation = { ...(data.splatPresentation ?? {}) };
    // Same as splat: the already-recorded aspect is carried over, never recaptured from the view.
    if (view) presentation.camera = cameraPoseFromView(view, data.splatPresentation?.camera?.aspect);
    if (hasAnimation(anim.anim)) presentation.cameraAnim = anim.anim;
    await persist(presentation);
  }, [model3d, anim.anim, persist, data.splatPresentation]);

  const clear = useCallback(async () => {
    await remove();
    anim.setAnim(emptyAnim());
  }, [remove, anim]);

  return {
    anim,
    busy,
    // The action and its state leave together: the transport button must say what is attached.
    attach: { toggle: toggleAttach, attached: ann.cameraAnim != null },
    importGltf,
    applyOrbitPreset,
    save: canManage ? save : undefined,
    clear: canManage ? clear : undefined,
  };
}
