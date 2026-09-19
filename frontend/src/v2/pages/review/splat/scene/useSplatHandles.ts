// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, type RefObject } from 'react';
import type { Hotspot3D, SplatTransform } from '../../reviewTypes';
import type { FlyControls } from '../../viewer/flyControls';
import type { PipRect } from '../../viewer/pipWindow';
import type { RenderGate } from '../../viewer/renderScheduler';
import { toNdc } from '../../three/usdPicking';
import { applySplatTransform, parseHotspotPoint } from './meshPose';
import type { PointCloud } from './pointCloud';
import { raycastAt, raycastCenter as raycastCenterCore } from './raycast';
import { applyRenderModeToScene, type RenderMode } from './renderModes';
import type { SplatHandles, SplatScene, SplatSceneHandle } from './splatViewerTypes';
import type { SplatStats, StatsSampler } from './stats';
import { applyCulling } from './viewerConfig';

/** Refs de la scène que `useSplat` monte et que les poignées ne font que lire (ou piloter). */
export interface SplatSceneRefs {
  sceneRef: RefObject<SplatScene | null>;
  threeRef: RefObject<typeof import('three') | null>;
  hotspotRef: RefObject<ReturnType<typeof parseHotspotPoint>>;
  captureReq: RefObject<((d: string | null) => void) | null>;
  pointsRef: RefObject<PointCloud | null>;
  statsRef: RefObject<StatsSampler | null>;
  frameCbs: RefObject<Set<(dt: number) => void>>;
  flyRef: RefObject<FlyControls | null>;
  pipRectRef: RefObject<PipRect | null>;
  /** Rendu à la demande (F14) — `subscribeStats` y compte les lecteurs de FPS. */
  gate: RenderGate;
}

/**
 * Poignées impératives du viewer splat : raycast, hotspot, miniature, transformation, modes de
 * rendu, stats, culling, PiP. Extraites de `useSplat` (budget lignes), qui garde le cycle de vie
 * de la scène et la boucle de rendu — ici, rien ne monte ni ne démonte quoi que ce soit, chaque
 * fonction lit les refs au moment de l'appel. Ordre d'origine conservé.
 */
export function useSplatHandles(refs: SplatSceneRefs): SplatHandles {
  const { sceneRef, threeRef, hotspotRef, captureReq, pointsRef, statsRef } = refs;
  const { frameCbs, flyRef, pipRectRef, gate } = refs;

  const raycastCenter = useCallback((): Hotspot3D | null => {
    const s = sceneRef.current;
    const THREE = threeRef.current;
    if (!s || !THREE) return null;
    return raycastCenterCore(THREE, s.camera, s.mesh);
  }, [sceneRef, threeRef]);

  /** Hotspot posé sous le pointeur (coordonnées client) — placement au clic dans le viewer. */
  const hotspotAtPointer = useCallback(
    (clientX: number, clientY: number): Hotspot3D | null => {
      const s = sceneRef.current;
      const THREE = threeRef.current;
      if (!s || !THREE) return null;
      const rect = s.renderer.domElement.getBoundingClientRect();
      return raycastAt(THREE, s.camera, s.mesh, toNdc(clientX, clientY, rect));
    },
    [sceneRef, threeRef],
  );

  const showHotspot = useCallback(
    (hs: Hotspot3D | null) => {
      const THREE = threeRef.current;
      hotspotRef.current = hs && THREE ? parseHotspotPoint(THREE, hs) : null;
    },
    [hotspotRef, threeRef],
  );

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
    // L'échantillonneur existe dès le montage de la scène (avant `ready`) ; les panneaux du
    // HUD ne sont montés qu'une fois le viewer prêt, l'abonnement est donc toujours effectif.
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
    raycastCenter,
    hotspotAtPointer,
    showHotspot,
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
