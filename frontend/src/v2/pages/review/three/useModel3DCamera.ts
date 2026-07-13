import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import type { MediaResp, SplatEditsPatch, SplatPresentation } from '../reviewTypes';
import type { Annotations } from '../useAnnotations';
import { orbitPreset } from '../splat/camera/cameraAnim';
import { useCameraKeyframes } from '../splat/camera/useCameraKeyframes';
import { cameraPoseFromView } from '../camera/cameraPose';
import { useCameraPresentation } from '../camera/useCameraPresentation';
import { importCameraFromGltf } from './importCameraGltf';
import type { Model3DThreeState } from './useModel3DThree';

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
  const kf = useCameraKeyframes(model3d.layoutController);
  const { busy, persist, remove } = useCameraPresentation(data.media.id, onSaved);
  const { setAll, play } = kf;
  const { ready, restoreCamera, setFov, setRoll } = model3d;

  // Mode layout : rejoue l'animation caméra jointe au commentaire sélectionné.
  const viewedCameraAnim = ann.viewedCameraAnim;
  useEffect(() => {
    if (viewedCameraAnim) {
      setAll(viewedCameraAnim.keyframes, viewedCameraAnim.loop, viewedCameraAnim.smooth);
      play();
    }
  }, [viewedCameraAnim, setAll, play]);

  const attach = useCallback(() => {
    if (kf.keyframes.length < 2) return;
    ann.setCameraAnim({ keyframes: kf.keyframes, loop: kf.loop, smooth: kf.smooth });
    toast.success('Animation caméra jointe au prochain commentaire');
  }, [kf.keyframes, kf.loop, kf.smooth, ann]);

  const importGltf = useCallback(
    (file: File) => {
      void importCameraFromGltf(file)
        .then((animData) => {
          if (!animData) {
            toast.error('Aucune animation caméra dans ce fichier');
            return;
          }
          setAll(animData.keyframes, false, false);
          play();
          toast.success('Animation caméra importée');
        })
        .catch(() => toast.error('Import caméra impossible'));
    },
    [setAll, play],
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
    if (pres.cameraAnim && pres.cameraAnim.keyframes.length >= 2) {
      setAll(pres.cameraAnim.keyframes, pres.cameraAnim.loop, pres.cameraAnim.smooth);
      play();
    }
  }, [ready, pres, restoreCamera, setFov, setRoll, setAll, play]);

  const applyOrbitPreset = useCallback(() => {
    const view = model3d.captureCamera();
    if (!view) return;
    kf.setAll(orbitPreset(view), true);
    kf.play();
  }, [model3d, kf]);

  const save = useCallback(async () => {
    const view = model3d.captureCamera();
    const presentation: SplatPresentation = {};
    if (view) presentation.camera = cameraPoseFromView(view);
    if (kf.keyframes.length >= 2)
      presentation.cameraAnim = { keyframes: kf.keyframes, loop: kf.loop, smooth: kf.smooth };
    await persist(presentation);
  }, [model3d, kf.keyframes, kf.loop, kf.smooth, persist]);

  const clear = useCallback(async () => {
    await remove();
    kf.setAll([], true);
  }, [remove, kf]);

  return {
    kf,
    busy,
    attach,
    importGltf,
    applyOrbitPreset,
    save: canManage ? save : undefined,
    clear: canManage ? clear : undefined,
  };
}
