// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import type { Hotspot3D } from '../reviewTypes';
import { announcePoiAnchors, POI_ANCHOR_ATTR } from '../poi/poiAnchor';
import { isDrawn } from './sceneOverrideApply';
import { isClickGesture } from './usdPicking';

/**
 * Surface point hit by a camera ray (NDC). As for prim selection, invisible objects are discarded:
 * the options of a USD variant are all baked in the same place in the GLB, and without this filter
 * the ray would hit the one nobody sees.
 */
export function raycastSurface(
  three: typeof import('three'),
  camera: THREE.Camera,
  object: THREE.Object3D,
  ndc: { x: number; y: number },
): THREE.Intersection | null {
  const raycaster = new three.Raycaster();
  raycaster.setFromCamera(new three.Vector2(ndc.x, ndc.y), camera);
  return raycaster.intersectObject(object, true).find((h) => isDrawn(h.object)) ?? null;
}

/**
 * Surface hotspot for a Three model, placed **where one clicks** (pointer NDC). The point is stored
 * in the group's **object space** (it follows the transform, like the splat, 10.G-V10).
 * `null` if the ray hits nothing.
 *
 * History: the hotspot could only be placed at the center of the screen, which forced re-framing
 * the camera to point at a defect — even though click picking already existed right next door
 * (`usdPicking`). The "center" fallback was REMOVED in Phase 50 (batch 12): its only caller placed
 * a point by default when entering annotation, without anyone having designated it.
 */
export function raycastModelPoint(
  three: typeof import('three'),
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  ndc: { x: number; y: number },
): Hotspot3D | null {
  const hit = raycastSurface(three, camera, object, ndc);
  if (!hit) return null;
  const p = hit.point;
  const n = camera.position.clone().sub(p).normalize();
  object.updateMatrixWorld();
  const local = p.clone().applyMatrix4(new three.Matrix4().copy(object.matrixWorld).invert());
  return { position: `${local.x} ${local.y} ${local.z}`, normal: `${n.x} ${n.y} ${n.z}`, space: 'object' };
}

/** Anchor point of a marker: position (object or world space) and its display number. */
export interface MarkerPoint {
  point: THREE.Vector3;
  objectSpace: boolean;
}

/** Serialized point (`"x y z"`) → marker point; `null` if the string is unusable. */
export function toMarkerPoint(three: typeof import('three'), hs: Hotspot3D): MarkerPoint | null {
  const [x, y, z] = hs.position.split(/\s+/).map((v) => parseFloat(v));
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return { point: new three.Vector3(x, y, z), objectSpace: hs.space === 'object' };
}

/**
 * DOM markers for points of interest (numbered dots) projected on screen every frame — generic
 * over an `Object3D`, so the SAME code serves the 3D model and the splat (points in object space
 * follow the world matrix of the object passed in).
 *
 * The dots become manipulable when the caller provides handlers (`setInteractive`): this is the
 * case while drafting, where a point is moved by dragging its dot and designated by clicking it.
 * In read-back they stay inert — a sent comment is not rewritten when the mouse passes over it.
 *
 * Each dot carries its rank (`poi/poiAnchor`) and its appearance is announced on the container:
 * the React layer of comment cards anchors itself there via a portal, and thus follows the point
 * without reprojecting anything. It is the only link between this file and React.
 */
export interface MarkerHandlers {
  /** Dot dragged then dropped elsewhere: the point of this rank is reset under the pointer. */
  onMove: (index: number, clientX: number, clientY: number) => void;
  /** Dot clicked without moving: the point of this rank becomes the one being edited. */
  onSelect: (index: number) => void;
  /** Accessible label of a dot, number included — translated by the caller. */
  label: (index: number) => string;
}

export interface ObjectMarker {
  update(
    points: MarkerPoint[] | null,
    camera: THREE.PerspectiveCamera,
    object: THREE.Object3D,
    width: number,
    height: number,
  ): void;
  /** Arms (or disarms, with `null`) moving and designating the dots. */
  setInteractive(handlers: MarkerHandlers | null): void;
  /** Highlighted rank (the composer row being edited), or `null`. */
  setActive(index: number | null): void;
  remove(): void;
}

const MARKER_CLASS =
  'absolute left-0 top-0 z-[5] flex h-5 w-5 items-center justify-center rounded-full border-2 text-xs font-semibold shadow';
/** Resting dot: it must not steal the pointer from the orbit. */
const IDLE_CLASS = 'pointer-events-none border-background bg-primary text-primary-foreground';
/** Manipulable dot — the cursor announces that it can be dragged. */
const LIVE_CLASS = 'cursor-grab border-background bg-primary text-primary-foreground';
/** Dot of the point being edited: the same set of tokens, inverted. */
const ACTIVE_CLASS = 'cursor-grab border-primary bg-background text-primary';

export function createObjectMarker(three: typeof import('three'), container: HTMLElement): ObjectMarker {
  const els: HTMLDivElement[] = [];
  const proj = new three.Vector3();
  let handlers: MarkerHandlers | null = null;
  let active: number | null = null;

  const skin = (el: HTMLDivElement, index: number) => {
    const state = !handlers ? IDLE_CLASS : index === active ? ACTIVE_CLASS : LIVE_CLASS;
    el.className = `${MARKER_CLASS} ${state}`;
    if (handlers) {
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', handlers.label(index));
      el.title = handlers.label(index);
    } else {
      el.removeAttribute('role');
      el.removeAttribute('aria-label');
      el.removeAttribute('title');
    }
  };

  /** Dot of rank `i`, created on demand (a single point = a single node in the DOM). */
  const elementAt = (i: number): HTMLDivElement => {
    let el = els[i];
    if (!el) {
      el = document.createElement('div');
      el.textContent = String(i + 1);
      el.style.display = 'none';
      // Rank published on the dot: a React layer anchors itself to it (`poi/poiAnchor`)
      // to follow the point without reprojecting itself.
      el.setAttribute(POI_ANCHOR_ATTR, String(i));
      // A single set of listeners per dot, bound at creation: they read `handlers` at the
      // time of the gesture, so (dis)arming adds and removes nothing.
      let down: { x: number; y: number } | null = null;
      el.addEventListener('pointerdown', (e) => {
        if (!handlers || e.button !== 0) return;
        down = { x: e.clientX, y: e.clientY };
        // The canvas must neither orbit nor place an extra point under the dot.
        e.stopPropagation();
        e.preventDefault();
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          // Synthetic pointers without capture (tests): the gesture still works.
        }
      });
      el.addEventListener('pointerup', (e) => {
        const start = down;
        down = null;
        if (!handlers || !start || e.button !== 0) return;
        e.stopPropagation();
        if (isClickGesture(e.clientX - start.x, e.clientY - start.y)) handlers.onSelect(i);
        else handlers.onMove(i, e.clientX, e.clientY);
      });
      els[i] = el;
      skin(el, i);
      container.appendChild(el);
      announcePoiAnchors(container);
    }
    return el;
  };

  return {
    update(points, camera, object, width, height) {
      const list = points ?? [];
      for (let i = 0; i < Math.max(list.length, els.length); i++) {
        const el = els[i] ?? (i < list.length ? elementAt(i) : null);
        if (!el) continue;
        const hs = list[i];
        if (hs && width > 0 && height > 0) {
          proj.copy(hs.point);
          if (hs.objectSpace) proj.applyMatrix4(object.matrixWorld);
          proj.project(camera);
          if (proj.z < 1) {
            const x = (proj.x * 0.5 + 0.5) * width;
            const y = (-proj.y * 0.5 + 0.5) * height;
            el.style.transform = `translate(${x - 10}px, ${y - 10}px)`;
            el.style.display = 'flex';
            continue;
          }
        }
        if (el.style.display !== 'none') el.style.display = 'none';
      }
    },
    setInteractive(next) {
      handlers = next;
      els.forEach(skin);
    },
    setActive(index) {
      active = index;
      els.forEach(skin);
    },
    remove: () => {
      els.forEach((el) => el.remove());
      els.length = 0;
      announcePoiAnchors(container);
    },
  };
}
