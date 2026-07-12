import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../../../../lib/apiClient';
import type { MediaResp, SplatEditsPatch, SplatPresentation } from '../../reviewTypes';
import { orbitPreset } from '../camera/cameraAnim';
import { useCameraKeyframes } from '../camera/useCameraKeyframes';
import { useCameraRig } from '../camera/useCameraRig';
import { createDebugColor, type DebugColorMode, type DebugColorRuntime } from '../scene/effects/debugColor';
import { createReveal, type RevealRuntime, type RevealType } from '../scene/effects/reveal';
import { applyLod, createAutoLod, type LodMode } from '../scene/lod';
import type { SplatViewer } from '../useSplat';

export interface RevealConfig {
  type: RevealType;
  durationMs: number;
}

/**
 * Présentation du splat (10.G-V5/V6) : caméra (rig + keyframes), effet de reveal (rejoué à
 * l'ouverture pour tous, re-jouable localement) et debug color (inspection locale, non
 * persistée). Le gestionnaire persiste l'ensemble via PATCH `/splat-presentation` ; les
 * spectateurs modifient tout en session sans écrire.
 */
export function usePresentation(
  splat: SplatViewer,
  data: MediaResp,
  onSaved: (patch: SplatEditsPatch) => void,
) {
  const { ready, captureCamera, getSceneHandle, subscribeFrame, subscribeStats } = splat;
  const kf = useCameraKeyframes(splat);
  const rig = useCameraRig(splat, data.splatPresentation, kf);
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState<RevealConfig | null>(data.splatPresentation?.reveal ?? null);
  // Compteur de lecture du reveal : > 0 → joue (initialisé à 1 si persisté → rejoué à l'ouverture).
  const [revealRun, setRevealRun] = useState(() => (data.splatPresentation?.reveal ? 1 : 0));
  const [debugMode, setDebugMode] = useState<DebugColorMode>('none');
  const [lodMode, setLodMode] = useState<LodMode>(data.splatPresentation?.lodDefault ?? 'auto');

  const replayReveal = useCallback(() => setRevealRun((v) => v + 1), []);

  // LOD (V7) : modes on/off/streaming appliqués directement ; auto = machine à états sur le
  // FPS échantillonné (< 15 fps pendant 5 s → LOD, hystérésis à 25 fps pour relâcher).
  useEffect(() => {
    if (!ready) return;
    const handle = getSceneHandle();
    if (!handle) return;
    const spark = handle.spark;
    if (lodMode !== 'auto') {
      applyLod(spark, lodMode !== 'off', lodMode === 'streaming');
      return () => applyLod(spark, false, false);
    }
    const auto = createAutoLod();
    applyLod(spark, false, false);
    // L'échantillonneur émet toutes les ~500 ms (fenêtre du sampler V1).
    const off = subscribeStats((stats) => {
      const was = auto.engaged;
      if (auto.step(stats.fps, 500) !== was) {
        applyLod(spark, auto.engaged, false);
        toast.info(
          auto.engaged
            ? 'LOD activé automatiquement (fréquence d’images faible)'
            : 'LOD désactivé (fréquence d’images rétablie)',
        );
      }
    });
    return () => {
      off();
      applyLod(spark, false, false);
    };
  }, [ready, lodMode, getSceneHandle, subscribeStats]);

  // Lecture de l'effet de reveal (à l'ouverture et sur « Rejouer »).
  useEffect(() => {
    if (!ready || !reveal || revealRun === 0) return;
    const handle = getSceneHandle();
    if (!handle) return;
    let disposed = false;
    let runtime: RevealRuntime | null = null;
    let offFrame: (() => void) | null = null;
    let elapsed = 0;
    void (async () => {
      const { dyno } = await import('@sparkjsdev/spark');
      if (disposed) return;
      runtime = createReveal(dyno, handle.mesh, reveal.type);
      runtime.update(0);
      offFrame = subscribeFrame((dt) => {
        elapsed += dt * 1000;
        const u = Math.min(elapsed / reveal.durationMs, 1);
        runtime?.update(u);
        if (u >= 1) {
          // Effet terminé : retire le modifier (rendu normal, plus de coût shader).
          offFrame?.();
          offFrame = null;
          runtime?.dispose();
          runtime = null;
        }
      });
    })();
    return () => {
      disposed = true;
      offFrame?.();
      runtime?.dispose();
    };
  }, [ready, reveal, revealRun, getSceneHandle, subscribeFrame]);

  // Debug color (inspection locale) : normales, ou profondeur (heatmap recalée chaque frame).
  useEffect(() => {
    if (!ready || debugMode === 'none') return;
    const handle = getSceneHandle();
    if (!handle) return;
    let disposed = false;
    let runtime: DebugColorRuntime | null = null;
    let offFrame: (() => void) | null = null;
    void (async () => {
      const { dyno } = await import('@sparkjsdev/spark');
      if (disposed) return;
      runtime = createDebugColor(dyno, handle.mesh, debugMode);
      if (debugMode === 'depth') {
        const { THREE, mesh, camera } = handle;
        const sphere = new THREE.Sphere(new THREE.Vector3(), 1);
        try {
          mesh.getBoundingBox(true).getBoundingSphere(sphere);
          mesh.updateMatrixWorld();
          sphere.applyMatrix4(mesh.matrixWorld);
        } catch {
          // bbox indisponible : sphère unitaire par défaut
        }
        offFrame = subscribeFrame(() => {
          const dist = camera.position.distanceTo(sphere.center);
          runtime?.updateCamera(camera.position, Math.max(dist - sphere.radius, 0), dist + sphere.radius);
        });
      }
    })();
    return () => {
      disposed = true;
      offFrame?.();
      runtime?.dispose();
    };
  }, [ready, debugMode, getSceneHandle, subscribeFrame]);

  /** Enregistre la présentation : vue courante + DoF + reveal + animation (gestionnaire). */
  const save = async () => {
    setBusy(true);
    try {
      const view = captureCamera();
      const presentation: SplatPresentation = {};
      if (view)
        presentation.camera = {
          position: view.position,
          target: view.target,
          fov: view.fov,
          roll: view.roll,
        };
      if (rig.aperture > 0)
        presentation.dof = { focalDistance: rig.focalDistance(), apertureAngle: rig.aperture };
      if (reveal) presentation.reveal = reveal;
      presentation.lodDefault = lodMode;
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

  /** Efface la présentation persistée (retour au cadrage automatique). */
  const clear = async () => {
    setBusy(true);
    try {
      await api.patch(`/api/media/${data.media.id}/splat-presentation`, { presentation: null });
      onSaved({ splatPresentation: null });
      kf.setAll([], true);
      setReveal(null);
      toast.success('Présentation effacée');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur à l'effacement de la présentation");
    } finally {
      setBusy(false);
    }
  };

  /** Preset orbite : un tour complet autour de la cible courante, en boucle. */
  const applyOrbitPreset = () => {
    const view = captureCamera();
    if (!view) return;
    kf.setAll(orbitPreset(view), true);
    kf.play();
  };

  return {
    kf,
    rig,
    busy,
    reveal,
    setReveal,
    replayReveal,
    debugMode,
    setDebugMode,
    lodMode,
    setLodMode,
    save,
    clear,
    applyOrbitPreset,
  };
}

export type PresentationState = ReturnType<typeof usePresentation>;
