// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { MediaResp, SplatEditsPatch, SplatPresentation } from '../../reviewTypes';
import { useCameraRig } from '../camera/useCameraRig';
import { useSplatLayout } from '../camera/useSplatLayout';
import { cameraPoseFromView } from '../../camera/cameraPose';
import { useCameraAnim } from '../../camera/useCameraAnim';
import { orbitPresetV2 } from '../../camera/channels/orbitPreset';
import { confirmReplaceAnim } from '../../camera/confirmReplaceAnim';
import { emptyAnim, hasAnimation } from '../../camera/channels/model';
import { useCameraPresentation } from '../../camera/useCameraPresentation';
import { createDebugColor, type DebugColorMode, type DebugColorRuntime } from '../scene/effects/debugColor';
import { createReveal, type RevealRuntime, type RevealType } from '../scene/effects/reveal';
import { applyLod, createAutoLod, type LodMode } from '../scene/lod';
import type { SplatViewer } from '../useSplat';
import { useT } from '../../../../i18n';

export interface RevealConfig {
  type: RevealType;
  durationMs: number;
}

/**
 * Presentation of the splat (10.G-V5/V6): camera (rig and keyframes), reveal effect (replayed on
 * opening for everyone, replayable locally) and debug colour (local inspection, not persisted).
 * The manager persists everything via PATCH `/splat-presentation`; viewers change everything in
 * session without writing.
 */
export function usePresentation(
  splat: SplatViewer,
  data: MediaResp,
  onSaved: (patch: SplatEditsPatch) => void,
) {
  const t = useT();
  const { ready, captureCamera, getSceneHandle, subscribeFrame, subscribeStats } = splat;
  // Layout mode (Phase 27): outside the mode, the controller is transparent (main camera);
  // in the mode, the keyframe player drives the layout camera rendered in the PiP.
  const layout = useSplatLayout(splat);
  const anim = useCameraAnim(layout.layoutController);
  const rig = useCameraRig(splat, data.splatPresentation, anim);
  const { busy, persist, remove } = useCameraPresentation(data.media.id, onSaved);
  const [reveal, setReveal] = useState<RevealConfig | null>(data.splatPresentation?.reveal ?? null);
  // Reveal play counter: > 0 means playing (initialised to 1 if persisted, so it replays on opening).
  const [revealRun, setRevealRun] = useState(() => (data.splatPresentation?.reveal ? 1 : 0));
  const [debugMode, setDebugMode] = useState<DebugColorMode>('none');
  const [lodMode, setLodMode] = useState<LodMode>(data.splatPresentation?.lodDefault ?? 'auto');

  const replayReveal = useCallback(() => setRevealRun((v) => v + 1), []);

  // LOD (V7): on/off/streaming modes applied directly; auto = state machine on the sampled FPS
  // (< 15 fps for 5 s triggers LOD, hysteresis at 25 fps to release).
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
    // The sampler emits roughly every 500 ms (V1 sampler window).
    const off = subscribeStats((stats) => {
      const was = auto.engaged;
      if (auto.step(stats.fps, 500) !== was) {
        applyLod(spark, auto.engaged, false);
        toast.info(auto.engaged ? t('splat.lodAuto') : t('splat.lodOff'));
      }
    });
    return () => {
      off();
      applyLod(spark, false, false);
    };
  }, [ready, lodMode, getSceneHandle, subscribeStats, t]);

  // Plays the reveal effect (on opening and on "Replay").
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
          // Effect finished: removes the modifier (normal rendering, no more shader cost).
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

  // Debug colour (local inspection): normals, or depth (heatmap recomputed every frame).
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
          // bbox unavailable: default unit sphere
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

  /** Saves the presentation: current view, DoF, reveal and animation (manager). */
  const save = async () => {
    const view = captureCamera();
    const presentation: SplatPresentation = {};
    // The frame ratio is not a camera value: we carry over the one already saved
    // (media already annotated) and charge none when nobody chose it.
    if (view) presentation.camera = cameraPoseFromView(view, data.splatPresentation?.camera?.aspect);
    if (rig.aperture > 0)
      presentation.dof = { focalDistance: rig.focalDistance(), apertureAngle: rig.aperture };
    if (reveal) presentation.reveal = reveal;
    presentation.lodDefault = lodMode;
    if (hasAnimation(anim.anim)) presentation.cameraAnim = anim.anim;
    await persist(presentation);
  };

  /** Clears the persisted presentation (back to automatic framing). */
  const clear = async () => {
    await remove();
    anim.setAnim(emptyAnim());
    setReveal(null);
  };

  /** Orbit preset: one full turn around the current target, looping, at the view distance.
   * Warns before overwriting an existing animation (Phase 27). */
  const applyOrbitPreset = () => {
    const view = captureCamera();
    if (!view) return;
    const run = () => {
      anim.setAnim(orbitPresetV2(view));
      anim.play();
    };
    if (anim.hasAnimation) confirmReplaceAnim(run);
    else run();
  };

  return {
    anim,
    layout,
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
