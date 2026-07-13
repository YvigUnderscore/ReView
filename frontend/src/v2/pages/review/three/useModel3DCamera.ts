import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../../../lib/apiClient';
import type { MediaResp, SplatEditsPatch, SplatPresentation } from '../reviewTypes';
import type { Annotations } from '../useAnnotations';
import { orbitPreset } from '../splat/camera/cameraAnim';
import { useCameraKeyframes } from '../splat/camera/useCameraKeyframes';
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
  const [busy, setBusy] = useState(false);
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
    setBusy(true);
    try {
      const view = model3d.captureCamera();
      const presentation: SplatPresentation = {};
      if (view)
        presentation.camera = {
          position: view.position,
          target: view.target,
          fov: view.fov,
          aspect: view.aspect,
          roll: view.roll,
        };
      if (kf.keyframes.length >= 2)
        presentation.cameraAnim = { keyframes: kf.keyframes, loop: kf.loop, smooth: kf.smooth };
      const { splatPresentation } = await api.patch<{ splatPresentation: SplatPresentation | null }>(
        `/api/media/${data.media.id}/splat-presentation`,
        { presentation },
      );
      onSaved({ splatPresentation });
      toast.success('Présentation enregistrée — rejouée pour tous à l’ouverture');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur à l'enregistrement de la présentation");
    } finally {
      setBusy(false);
    }
  }, [model3d, kf.keyframes, kf.loop, kf.smooth, data.media.id, onSaved]);

  const clear = useCallback(async () => {
    setBusy(true);
    try {
      await api.patch(`/api/media/${data.media.id}/splat-presentation`, { presentation: null });
      onSaved({ splatPresentation: null });
      kf.setAll([], true);
      toast.success('Présentation effacée');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur à l'effacement de la présentation");
    } finally {
      setBusy(false);
    }
  }, [data.media.id, onSaved, kf]);

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
