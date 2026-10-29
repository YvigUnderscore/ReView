// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, type RefObject } from 'react';
import type { SplatTransform } from '../../reviewTypes';
import type { FlyControls } from '../../viewer/flyControls';
import type { PipRect } from '../../viewer/pipWindow';
import type { RenderGate } from '../../viewer/renderScheduler';
import { applySplatTransform } from './meshPose';
import type { PointCloud } from './pointCloud';
import { applyRenderModeToScene, type RenderMode } from './renderModes';
import type { SplatHandles, SplatScene, SplatSceneHandle } from './splatViewerTypes';
import type { SplatStats, StatsSampler } from './stats';
import { applyCulling } from './viewerConfig';

/** Scene refs that `useSplat` mounts and that the handles only read (or drive). */
export interface SplatSceneRefs {
  sceneRef: RefObject<SplatScene | null>;
  threeRef: RefObject<typeof import('three') | null>;
  captureReq: RefObject<((d: string | null) => void) | null>;
  pointsRef: RefObject<PointCloud | null>;
  statsRef: RefObject<StatsSampler | null>;
  frameCbs: RefObject<Set<(dt: number) => void>>;
  flyRef: RefObject<FlyControls | null>;
  pipRectRef: RefObject<PipRect | null>;
  /** On-demand rendering (F14): `subscribeStats` counts the FPS readers here. */
  gate: RenderGate;
}

/**
 * Imperative handles of the splat viewer: thumbnail, transform, render modes, stats, culling, PiP.
 * The points of interest are no longer part of them: they are passed to the shared hook
 * `poi/usePoiMarkers`, the same one as the 3D viewer. Extracted from `useSplat` (line budget),
 * which keeps the scene lifecycle and the render loop. Here nothing mounts or unmounts anything:
 * each function reads the refs at call time. Original order preserved.
 */
export function useSplatHandles(refs: SplatSceneRefs): SplatHandles {
  const { sceneRef, threeRef, captureReq, pointsRef, statsRef } = refs;
  const { frameCbs, flyRef, pipRectRef, gate } = refs;

  const captureThumbnail = useCallback(
    (): Promise<string | null> =>
      new Promise((resolve) => {
        if (!sceneRef.current) resolve(null);
        else captureReq.current = resolve;
      }),
    [captureReq, sceneRef],
  );

  const applyTransform = useCallback(
    (t: SplatTransform | null) => {
      const s = sceneRef.current;
      if (s) applySplatTransform(s.mesh, t);
    },
    [sceneRef],
  );

  const setBaseFlip = useCallback(
    (flip: boolean) => {
      const s = sceneRef.current;
      if (!s) return;
      s.pivot.rotation.x = flip ? Math.PI : 0;
      s.pivot.updateMatrixWorld(true);
    },
    [sceneRef],
  );

  const subscribeStats = useCallback(
    // The sampler exists as soon as the scene is mounted (before `ready`); the HUD panels
    // are only mounted once the viewer is ready, so the subscription is always effective.
    (cb: (stats: SplatStats) => void): (() => void) =>
      gate.countSub(statsRef.current?.subscribe(cb)) ?? (() => undefined),
    [gate, statsRef],
  );

  const setCullingOff = useCallback(
    (off: boolean) => {
      const s = sceneRef.current;
      if (s) applyCulling(s.spark, off);
    },
    [sceneRef],
  );

  const isFlying = useCallback(() => flyRef.current?.flying ?? false, [flyRef]);

  const setPipRect = useCallback(
    (rect: PipRect | null) => {
      pipRectRef.current = rect;
    },
    [pipRectRef],
  );

  const subscribeFrame = useCallback(
    (cb: (dt: number) => void): (() => void) => {
      frameCbs.current.add(cb);
      return () => frameCbs.current.delete(cb);
    },
    [frameCbs],
  );

  const getSceneHandle = useCallback((): SplatSceneHandle | null => {
    const s = sceneRef.current;
    const THREE = threeRef.current;
    if (!s || !THREE) return null;
    return {
      THREE,
      scene: s.scene,
      camera: s.camera,
      controls: s.controls,
      mesh: s.mesh,
      pivot: s.pivot,
      spark: s.spark,
      dom: s.renderer.domElement,
    };
  }, [sceneRef, threeRef]);

  const setRenderMode = useCallback(
    (mode: RenderMode) => {
      const s = sceneRef.current;
      const THREE = threeRef.current;
      if (s && THREE) pointsRef.current = applyRenderModeToScene(THREE, s, mode, pointsRef.current);
    },
    [pointsRef, sceneRef, threeRef],
  );

  const getDom = useCallback(() => sceneRef.current?.renderer.domElement ?? null, [sceneRef]);

  const reflectSelection = useCallback(
    (selected: ReadonlySet<number>) => {
      pointsRef.current?.setSelection(selected);
    },
    [pointsRef],
  );

  const reflectHidden = useCallback(
    (indices: Iterable<number>, hidden: boolean) => {
      pointsRef.current?.setHidden(indices, hidden);
    },
    [pointsRef],
  );

  const reflectCropped = useCallback(
    (indices: Iterable<number>) => {
      pointsRef.current?.setCropped(indices);
    },
    [pointsRef],
  );

  return {
    captureThumbnail,
    applyTransform,
    setBaseFlip,
    setRenderMode,
    reflectSelection,
    reflectHidden,
    reflectCropped,
    subscribeStats,
    subscribeFrame,
    setCullingOff,
    isFlying,
    setPipRect,
    getSceneHandle,
    getDom,
  };
}
