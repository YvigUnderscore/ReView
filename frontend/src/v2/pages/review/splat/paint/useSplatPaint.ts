// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState } from 'react';
import type * as THREE from 'three';
import type { SplatPaintStroke } from '../../reviewTypes';
import type { SplatViewer } from '../useSplat';
import { buildStrokeMesh, decodeStrokes, disposeStrokeMesh } from './strokes';

/**
 * Painter 3D de review (10.G-V9) : traits peints sur la surface du splat (raycast par
 * échantillon du drag), stockés en **espace-objet** et rattachés au **commentaire** en cours
 * de rédaction (tableau `annotation`, comme le hotspot) — non destructif, visible pour tous.
 * Les tubes sont enfants du SplatMesh : ils suivent la transformation du média.
 */
export function useSplatPaint(splat: SplatViewer, isSplat: boolean) {
  const { getSceneHandle } = splat;
  const [active, setActive] = useState(false);
  const [color, setColor] = useState('#ff4d4d');
  const [width, setWidth] = useState(2);
  const [pendingCount, setPendingCount] = useState(0);
  // Traits du composer (en attente d'envoi) et traits du commentaire consulté.
  const pendingRef = useRef<{ stroke: SplatPaintStroke; tube: THREE.Mesh }[]>([]);
  const viewedRef = useRef<THREE.Mesh[]>([]);

  /** Peint un trait : raycast de chaque échantillon écran → polyligne en espace objet. */
  const addStroke = useCallback(
    (screenPts: [number, number][], viewport: { width: number; height: number }) => {
      const handle = getSceneHandle();
      if (!handle) return;
      const { THREE, mesh, camera } = handle;
      const raycaster = new THREE.Raycaster();
      mesh.updateMatrixWorld();
      const inverse = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
      const points: number[] = [];
      for (const [sx, sy] of screenPts) {
        raycaster.setFromCamera(
          new THREE.Vector2((sx / viewport.width) * 2 - 1, -(sy / viewport.height) * 2 + 1),
          camera,
        );
        const hits: { distance: number; point: THREE.Vector3; object: THREE.Object3D }[] = [];
        mesh.raycast(raycaster, hits);
        if (hits.length === 0) continue;
        hits.sort((a, b) => a.distance - b.distance);
        const p = hits[0].point.clone().applyMatrix4(inverse);
        points.push(p.x, p.y, p.z);
      }
      if (points.length < 6) return; // trait dans le vide ou trop court
      const stroke: SplatPaintStroke = { type: 'splat-paint', points, color, width };
      const tube = buildStrokeMesh(handle, stroke);
      mesh.add(tube);
      pendingRef.current.push({ stroke, tube });
      setPendingCount(pendingRef.current.length);
    },
    [getSceneHandle, color, width],
  );

  /** Annule le dernier trait du composer. */
  const undoStroke = useCallback(() => {
    const last = pendingRef.current.pop();
    if (last) disposeStrokeMesh(last.tube);
    setPendingCount(pendingRef.current.length);
  }, []);

  /** Retire tous les traits du composer (après envoi du commentaire, ou abandon). */
  const clearPending = useCallback(() => {
    pendingRef.current.forEach((p) => disposeStrokeMesh(p.tube));
    pendingRef.current = [];
    setPendingCount(0);
  }, []);

  /** Parties d'annotation à joindre au commentaire en cours d'envoi. */
  const serializePending = useCallback((): SplatPaintStroke[] => {
    return pendingRef.current.map((p) => p.stroke);
  }, []);

  /** Affiche les traits du commentaire sélectionné (null = masquer). */
  const showFromAnnotation = useCallback(
    (annotation: unknown) => {
      viewedRef.current.forEach(disposeStrokeMesh);
      viewedRef.current = [];
      const handle = getSceneHandle();
      if (!handle) return;
      for (const stroke of decodeStrokes(annotation)) {
        const tube = buildStrokeMesh(handle, stroke);
        handle.mesh.add(tube);
        viewedRef.current.push(tube);
      }
    },
    [getSceneHandle],
  );

  // Nettoyage au démontage (la page remonte par média : la scène disparaît avec les tubes).
  useEffect(
    () => () => {
      pendingRef.current.forEach((p) => disposeStrokeMesh(p.tube));
      pendingRef.current = [];
      viewedRef.current.forEach(disposeStrokeMesh);
      viewedRef.current = [];
    },
    [],
  );

  return {
    isSplat,
    active: active && isSplat,
    setActive,
    color,
    setColor,
    width,
    setWidth,
    pendingCount,
    addStroke,
    undoStroke,
    clearPending,
    serializePending,
    showFromAnnotation,
  };
}

export type SplatPaintState = ReturnType<typeof useSplatPaint>;
