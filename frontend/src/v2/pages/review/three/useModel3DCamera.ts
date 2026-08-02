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
import { useT } from '../../../i18n';

/**
 * Contrôleur caméra du viewer 3D Three (Phase 16/17) : lecteur keyframe (piloté par la caméra
 * layout en PiP, sinon la caméra principale), rejeu de la **présentation persistée** à
 * l'ouverture (pour tous), mode layout, et enregistrement de la présentation par le gestionnaire
 * (champ `splatPresentation` réutilisé, générique caméra). Extrait de l'ex-`Model3DCameraBar`
 * pour que l'orchestrateur `Model3DReview` reste sous le budget.
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

  // Mode layout : rejoue l'animation caméra jointe au commentaire sélectionné.
  const viewedCameraAnim = ann.viewedCameraAnim;
  useEffect(() => {
    if (viewedCameraAnim) {
      setAnim(viewedCameraAnim);
      play();
    }
  }, [viewedCameraAnim, setAnim, play]);

  const attach = useCallback(() => {
    if (!hasAnimation(anim.anim)) return;
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

  // Rejeu de la présentation persistée à l'ouverture (une fois la scène prête), pour tous.
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

  const applyOrbitPreset = useCallback(
    (radiusScale = 1) => {
      const view = model3d.captureCamera();
      if (!view) return;
      const run = () => {
        anim.setAnim(orbitPresetV2(view, { radiusScale }));
        anim.play();
      };
      if (anim.hasAnimation) confirmReplaceAnim(run);
      else run();
    },
    [model3d, anim],
  );

  const save = useCallback(async () => {
    const view = model3d.captureCamera();
    // Préserve les autres champs persistés (dont l'éclairage HDRI, Phase 29).
    const presentation: SplatPresentation = { ...(data.splatPresentation ?? {}) };
    if (view) presentation.camera = cameraPoseFromView(view);
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
    attach,
    importGltf,
    applyOrbitPreset,
    save: canManage ? save : undefined,
    clear: canManage ? clear : undefined,
  };
}
