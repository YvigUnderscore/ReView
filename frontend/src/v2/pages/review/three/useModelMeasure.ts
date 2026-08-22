// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState } from 'react';
import type * as THREE from 'three';
import { boxLengths, formatLength, worldToMetres } from './measure';
import { createMeasureGizmo, type MeasureGizmo } from './measureGizmo';
import { raycastSurface } from './objectHotspot';
import { isClickGesture, toNdc } from './usdPicking';
import type { Model3DThreeState } from './useModel3DThree';

/**
 * Outil de mesure point-à-point du viewer 3D (39.G) et dimensions de la boîte englobante.
 *
 * On clique deux points sur la surface : le repère les relie et la longueur s'affiche dans le
 * panneau Infos, exprimée en mètres via le `metersPerUnit` de la scène USD. Un troisième clic
 * repart d'un nouveau segment. L'échelle réellement appliquée est **lue sur la matrice monde**
 * du modèle (normalisation × transformation utilisateur) : mesurer en taille réelle ou en
 * taille normalisée donne donc le même résultat, comme il se doit.
 *
 * L'outil n'installe ses écouteurs que lorsqu'il est armé : hors mesure, le clic garde son
 * rôle habituel (sélection de prim).
 */
export function useModelMeasure(model3d: Model3DThreeState, metersPerUnit = 1) {
  const { ready, getSceneHandle, modelSize } = model3d;
  const [active, setActive] = useState(false);
  const [points, setPoints] = useState(0);
  const [metres, setMetres] = useState<number | null>(null);
  const gizmoRef = useRef<MeasureGizmo | null>(null);
  // `metersPerUnit` change avec le média, pas pendant une mesure : une ref évite de réinstaller
  // les écouteurs (et donc d'effacer la mesure en cours) à chaque rendu de la review.
  const mpuRef = useRef(metersPerUnit);
  useEffect(() => {
    mpuRef.current = metersPerUnit;
  }, [metersPerUnit]);

  const clear = useCallback(() => {
    gizmoRef.current?.setPoints([]);
    setPoints(0);
    setMetres(null);
  }, []);

  const toggle = useCallback(() => setActive((v) => !v), []);

  useEffect(() => {
    if (!active || !ready) return;
    const handle = getSceneHandle();
    const dom = handle?.dom;
    const root = handle?.modelObject;
    if (!handle || !dom || !root) return;
    const { THREE: three } = handle;
    const sphere = new three.Box3().setFromObject(root).getBoundingSphere(new three.Sphere());
    const gizmo = createMeasureGizmo(three, handle.scene, sphere.radius);
    gizmoRef.current = gizmo;
    let picked: THREE.Vector3[] = [];
    let down: { x: number; y: number } | null = null;

    const onDown = (e: PointerEvent) => {
      if (e.button === 0) down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      const start = down;
      down = null;
      // Même garde que la sélection de prim : un clic gauche qui a glissé est une orbite.
      if (e.button !== 0 || !start || !isClickGesture(e.clientX - start.x, e.clientY - start.y)) return;
      const ndc = toNdc(e.clientX, e.clientY, dom.getBoundingClientRect());
      const hit = raycastSurface(three, handle.camera, root, ndc);
      if (!hit) return;
      picked = picked.length >= 2 ? [hit.point.clone()] : [...picked, hit.point.clone()];
      gizmo.setPoints(picked);
      setPoints(picked.length);
      if (picked.length < 2) {
        setMetres(null);
        return;
      }
      const worldScale = root.getWorldScale(new three.Vector3()).x;
      setMetres(worldToMetres(picked[0].distanceTo(picked[1]), worldScale, mpuRef.current));
    };

    dom.addEventListener('pointerdown', onDown);
    dom.addEventListener('pointerup', onUp);
    return () => {
      dom.removeEventListener('pointerdown', onDown);
      dom.removeEventListener('pointerup', onUp);
      gizmo.dispose();
      gizmoRef.current = null;
      setPoints(0);
      setMetres(null);
    };
  }, [active, ready, getSceneHandle]);

  return {
    active,
    toggle,
    clear,
    /** Nombre de points posés (0, 1 ou 2) — le panneau invite à poser le second. */
    points,
    /** Longueur mesurée, `null` tant que les deux points ne sont pas posés. */
    length: metres == null ? null : formatLength(metres),
    /** Dimensions de la boîte englobante du fichier, en longueurs lisibles. */
    dimensions: modelSize ? boxLengths(modelSize, metersPerUnit) : null,
  };
}

export type ModelMeasureState = ReturnType<typeof useModelMeasure>;
