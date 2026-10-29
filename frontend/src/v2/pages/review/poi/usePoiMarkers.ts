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
 * Points of interest of a spatial viewer: **a single implementation**, shared by the 3D model and the splat.
 *
 * That was the request: "I want exactly the same implementation as in 3D". The two viewers differ only in
 * three things: the object carrying the points, the radius of the scene, and the way a ray is cast onto the
 * surface (a Three mesh on one side, a `SplatMesh` on the other). They arrive through `access`, read at call
 * time. Everything else (numbered hotspots, placement on click, moving, putting forward, camera return) is
 * this file, and this file alone.
 *
 * The hotspots live in a ref, never in a state: they are reprojected at each frame without triggering a
 * React render.
 */
export interface PoiSceneAccess {
  three: typeof import('three');
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  /** Carrying object of the points: the model group, or the cloud's `SplatMesh`. */
  object: THREE.Object3D;
  /** Render canvas: the raycast needs its rectangle to convert to NDC. */
  dom: HTMLElement;
  /** Radius of the scene: the framing scale of a point depends on it. */
  radius: number;
  /** Surface radius specific to the media: the one thing the two viewers do not share. */
  pick: (ndc: { x: number; y: number }) => Hotspot3D | null;
}

export interface PoiMarkers {
  /**
   * Mounts the hotspots in the viewer's container and returns their unmounting. The marker never leaves
   * here: the viewer merely mounts and projects it, and needs to know nothing more.
   */
  mountMarker: (three: typeof import('three'), container: HTMLElement) => () => void;
  /** Projects the points on screen: called by the render loop, at each drawn frame. */
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

  /** Point placed under the pointer (client coordinates): placement on click in the viewer. */
  const hotspotAtPointer = useCallback(
    (clientX: number, clientY: number): Hotspot3D | null => {
      const scene = access();
      if (!scene) return null;
      return scene.pick(toNdc(clientX, clientY, scene.dom.getBoundingClientRect()));
    },
    [access],
  );

  /** Displays the hotspots of the received points, numbered in order (empty list = none). */
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

  // Handlers may have been set before the scene was mounted (a point surviving from a previous media, an
  // early render): they are replayed on the new marker rather than leaving it inert.
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

  /** Brings the camera back to a point (number clicked in the thread): object space, hence for everyone. */
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
