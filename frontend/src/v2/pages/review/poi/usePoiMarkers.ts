// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useRef } from 'react';
import type * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Hotspot3D } from '../reviewTypes';
import {
  createObjectMarker,
  toMarkerPoint,
  type MarkerHandlers,
  type MarkerPoint,
  type ObjectMarker,
} from '../three/objectHotspot';
import { toNdc } from '../three/usdPicking';
import { focusObjectPoint } from './poiFocus';

/**
 * Points d'intérêt d'un viewer spatial — **une seule implémentation**, partagée par le modèle
 * 3D et le splat.
 *
 * C'était la demande : « je veux toute la même implémentation qu'en 3D ». Les deux viewers ne
 * diffèrent que par trois choses — l'objet qui porte les points, le rayon de la scène et la
 * façon de lancer un rayon sur la surface (un mesh Three d'un côté, un `SplatMesh` de l'autre).
 * Elles arrivent par `access`, lu au moment de l'appel ; tout le reste (pastilles numérotées,
 * pose au clic, déplacement, mise en avant, retour caméra) est ce fichier, et lui seul.
 *
 * Les pastilles vivent dans une ref, jamais dans un état : elles se reprojettent à chaque image
 * sans provoquer de rendu React.
 */
export interface PoiSceneAccess {
  three: typeof import('three');
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  /** Objet porteur des points : le groupe du modèle, le `SplatMesh` du nuage. */
  object: THREE.Object3D;
  /** Canvas de rendu — le raycast a besoin de son rectangle pour passer en NDC. */
  dom: HTMLElement;
  /** Rayon de la scène : l'échelle du cadrage d'un point en dépend. */
  radius: number;
  /** Rayon de surface propre au média — la seule chose que les deux viewers ne partagent pas. */
  pick: (ndc: { x: number; y: number }) => Hotspot3D | null;
}

export interface PoiMarkers {
  /**
   * Monte les pastilles dans le conteneur du viewer et rend leur démontage. Le marqueur ne sort
   * jamais d'ici : le viewer ne fait que le monter et projeter, il n'a rien à en savoir de plus.
   */
  mountMarker: (three: typeof import('three'), container: HTMLElement) => () => void;
  /** Projette les points à l'écran — appelé par la boucle de rendu, à chaque image dessinée. */
  project: (camera: THREE.PerspectiveCamera, object: THREE.Object3D, width: number, height: number) => void;
  hotspotAtPointer: (clientX: number, clientY: number) => Hotspot3D | null;
  showPoiPoints: (points: readonly Hotspot3D[]) => void;
  setPoiHandlers: (handlers: MarkerHandlers | null) => void;
  setPoiActive: (index: number | null) => void;
  focusPoi: (point: Hotspot3D) => boolean;
}

export function usePoiMarkers(access: () => PoiSceneAccess | null): PoiMarkers {
  const poiRef = useRef<MarkerPoint[] | null>(null);
  const markerRef = useRef<ObjectMarker | null>(null);
  const handlersRef = useRef<MarkerHandlers | null>(null);
  const activeRef = useRef<number | null>(null);

  /** Point posé sous le pointeur (coordonnées client) — placement au clic dans le viewer. */
  const hotspotAtPointer = useCallback(
    (clientX: number, clientY: number): Hotspot3D | null => {
      const scene = access();
      if (!scene) return null;
      return scene.pick(toNdc(clientX, clientY, scene.dom.getBoundingClientRect()));
    },
    [access],
  );

  /** Affiche les pastilles des points reçus, numérotées dans l'ordre (liste vide = aucune). */
  const showPoiPoints = useCallback(
    (points: readonly Hotspot3D[]) => {
      const three = access()?.three;
      if (!three || points.length === 0) {
        poiRef.current = null;
        return;
      }
      const marks = points.map((p) => toMarkerPoint(three, p)).filter((p): p is MarkerPoint => p !== null);
      poiRef.current = marks.length ? marks : null;
    },
    [access],
  );

  const setPoiHandlers = useCallback((handlers: MarkerHandlers | null) => {
    handlersRef.current = handlers;
    markerRef.current?.setInteractive(handlers);
  }, []);

  const setPoiActive = useCallback((index: number | null) => {
    activeRef.current = index;
    markerRef.current?.setActive(index);
  }, []);

  // Les gestionnaires peuvent avoir été posés avant que la scène ne soit montée (un point
  // survivant d'un média précédent, un rendu en avance) : on les rejoue sur le marqueur neuf
  // plutôt que de le laisser naître inerte.
  const mountMarker = useCallback((three: typeof import('three'), container: HTMLElement) => {
    const marker: ObjectMarker = createObjectMarker(three, container);
    marker.setInteractive(handlersRef.current);
    marker.setActive(activeRef.current);
    markerRef.current = marker;
    return () => {
      if (markerRef.current === marker) markerRef.current = null;
      poiRef.current = null;
      marker.remove();
    };
  }, []);

  const project = useCallback(
    (camera: THREE.PerspectiveCamera, object: THREE.Object3D, width: number, height: number) => {
      markerRef.current?.update(poiRef.current, camera, object, width, height);
    },
    [],
  );

  /** Ramène la caméra sur un point (numéro cliqué dans le fil) — espace objet, donc pour tous. */
  const focusPoi = useCallback(
    (point: Hotspot3D): boolean => {
      const scene = access();
      if (!scene) return false;
      return focusObjectPoint({
        three: scene.three,
        camera: scene.camera,
        controls: scene.controls,
        object: scene.object,
        point,
        sceneRadius: scene.radius,
      });
    },
    [access],
  );

  return { mountMarker, project, hotspotAtPointer, showPoiPoints, setPoiHandlers, setPoiActive, focusPoi };
}
