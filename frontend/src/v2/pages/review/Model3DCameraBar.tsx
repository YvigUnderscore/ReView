import { useEffect, useRef, useState } from 'react';
import { Pause, PictureInPicture2, Play, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import type { MediaResp, SplatEditsPatch, SplatPresentation } from './reviewTypes';
import type { Annotations } from './useAnnotations';
import { HudGroup, HudIconButton } from './hud/ViewerHud';
import { orbitPreset } from './splat/camera/cameraAnim';
import { useCameraKeyframes } from './splat/camera/useCameraKeyframes';
import KeyframeTimeline from './splat/camera/KeyframeTimeline';
import type { Model3DThreeState } from './three/useModel3DThree';

const deg = (rad: number) => Math.round((rad * 180) / Math.PI);

/**
 * Barre caméra du viewer 3D Three (mode layout, Phase 15/16) : focale (fov), tilt (roll), et
 * **timeline keyframes** (ajouter une pose, preset orbite, lecture/scrub, courbes) — réutilise
 * le lecteur `useCameraKeyframes` commun via l'interface `CameraController`. La **présentation
 * persistée** (caméra de base + animation) est rejouée pour tous à l'ouverture ; le gestionnaire
 * l'enregistre (champ `splatPresentation` réutilisé, générique caméra).
 */
export default function Model3DCameraBar({
  model3d,
  data,
  canManage,
  onSaved,
  ann,
}: {
  model3d: Model3DThreeState;
  data: MediaResp;
  canManage: boolean;
  onSaved: (patch: SplatEditsPatch) => void;
  ann: Annotations;
}) {
  // Le lecteur keyframe pilote la **caméra layout** en mode PiP (sinon la caméra principale).
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

  const attach = () => {
    if (kf.keyframes.length < 2) return;
    ann.setCameraAnim({ keyframes: kf.keyframes, loop: kf.loop, smooth: kf.smooth });
    toast.success('Animation caméra jointe au prochain commentaire');
  };

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

  const applyOrbitPreset = () => {
    const view = model3d.captureCamera();
    if (!view) return;
    kf.setAll(orbitPreset(view), true);
    kf.play();
  };

  const save = async () => {
    setBusy(true);
    try {
      const view = model3d.captureCamera();
      const presentation: SplatPresentation = {};
      if (view)
        presentation.camera = {
          position: view.position,
          target: view.target,
          fov: view.fov,
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
  };

  const clear = async () => {
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
  };

  return (
    <>
      <HudGroup>
        <label className="flex items-center gap-1.5 text-muted-foreground" title="Focale (champ de vision)">
          Focale
          <input
            type="range"
            min={20}
            max={120}
            value={Math.round(model3d.fov)}
            onChange={(e) => model3d.setFov(Number(e.target.value))}
            className="h-1 w-16 accent-primary"
          />
          <span className="w-6 font-mono text-foreground">{Math.round(model3d.fov)}°</span>
        </label>
        <label
          className="flex items-center gap-1.5 text-muted-foreground"
          title="Tilt (roll) : inclinaison de la caméra autour de l'axe de vue"
        >
          Tilt
          <input
            type="range"
            min={-180}
            max={180}
            value={deg(model3d.roll)}
            onChange={(e) => model3d.setRoll((Number(e.target.value) * Math.PI) / 180)}
            className="h-1 w-16 accent-primary"
          />
          <span className="w-8 font-mono text-foreground">{deg(model3d.roll)}°</span>
        </label>
        <HudIconButton
          icon={PictureInPicture2}
          hint="Mode layout : sortir de la caméra (vue libre) et voir son point de vue dans une fenêtre flottante (PiP)"
          active={model3d.layoutMode}
          onClick={() => model3d.setLayoutMode(!model3d.layoutMode)}
        />
        {kf.keyframes.length >= 2 && (
          <>
            <span className="h-4 w-px bg-border" />
            <HudIconButton
              icon={kf.playing ? Pause : Play}
              hint={kf.playing ? "Mettre l'animation caméra en pause" : "Lire l'animation caméra"}
              active={kf.playing}
              onClick={kf.playing ? kf.pause : kf.play}
            />
            {kf.autoPaused && (
              <button
                onClick={kf.play}
                title="L'animation s'est mise en pause quand vous avez repris la main — la relancer"
                className="flex items-center gap-1 rounded bg-primary px-2 py-1 font-medium text-primary-foreground"
              >
                <RotateCcw size={12} /> Réactiver
              </button>
            )}
          </>
        )}
      </HudGroup>
      <KeyframeTimeline
        kf={kf}
        onOrbitPreset={applyOrbitPreset}
        onSave={canManage ? save : undefined}
        onClear={canManage ? clear : undefined}
        busy={busy}
        onAttach={attach}
      />
    </>
  );
}
