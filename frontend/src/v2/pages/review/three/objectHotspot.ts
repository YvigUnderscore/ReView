// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import type { Hotspot3D } from '../reviewTypes';
import { announcePoiAnchors, POI_ANCHOR_ATTR } from '../poi/poiAnchor';
import { isDrawn } from './sceneOverrideApply';
import { isClickGesture } from './usdPicking';

/**
 * Point de surface visé par un rayon caméra (NDC). Comme pour la sélection de prim, les objets
 * invisibles sont écartés : les options d'une variante USD sont toutes cuites au même endroit
 * dans le GLB, et sans ce filtre le rayon accroche celle que personne ne voit.
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
 * Hotspot de surface pour un modèle Three, posé **là où l'on clique** (NDC du pointeur). Point
 * stocké en **espace-objet** du groupe (suit la transformation, comme le splat, 10.G-V10).
 * `null` si le rayon ne touche rien.
 *
 * Historique : le hotspot ne pouvait se poser qu'au centre de l'écran, ce qui obligeait à
 * recadrer la caméra pour désigner un défaut — alors que le picking au clic existait déjà juste
 * à côté (`usdPicking`). Le repli « au centre » a été RETIRÉ en Phase 50 (lot 12) : son seul
 * appelant posait un point d'office à l'entrée en annotation, sans que personne l'ait désigné.
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

/** Point d'ancrage d'un marqueur : position (espace objet ou monde) et son numéro d'affichage. */
export interface MarkerPoint {
  point: THREE.Vector3;
  objectSpace: boolean;
}

/** Point sérialisé (`"x y z"`) → point de marqueur ; `null` si la chaîne est inexploitable. */
export function toMarkerPoint(three: typeof import('three'), hs: Hotspot3D): MarkerPoint | null {
  const [x, y, z] = hs.position.split(/\s+/).map((v) => parseFloat(v));
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return { point: new three.Vector3(x, y, z), objectSpace: hs.space === 'object' };
}

/**
 * Marqueurs DOM des points d'intérêt (pastilles numérotées) projetés à l'écran chaque frame —
 * générique sur un `Object3D`, donc le MÊME code sert au modèle 3D et au splat (les points en
 * espace-objet suivent la matrice monde de l'objet passé).
 *
 * Les pastilles deviennent manipulables quand l'appelant fournit des gestionnaires
 * (`setInteractive`) : c'est le cas pendant la rédaction, où un point se déplace en tirant sa
 * pastille et se désigne en la cliquant. En relecture, elles restent inertes — un commentaire
 * envoyé ne se réécrit pas au passage de la souris.
 *
 * Chaque pastille porte son rang (`poi/poiAnchor`) et son apparition est annoncée sur le
 * conteneur : le calque React des cartes de commentaire s'y ancre par portail, et suit donc le
 * point sans reprojeter quoi que ce soit. C'est le seul lien entre ce fichier et React.
 */
export interface MarkerHandlers {
  /** Pastille tirée puis lâchée ailleurs : le point de ce rang se repose sous le pointeur. */
  onMove: (index: number, clientX: number, clientY: number) => void;
  /** Pastille cliquée sans déplacement : le point de ce rang devient celui qu'on édite. */
  onSelect: (index: number) => void;
  /** Libellé accessible d'une pastille, numéro compris — traduit par l'appelant. */
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
  /** Arme (ou désarme, avec `null`) le déplacement et la désignation des pastilles. */
  setInteractive(handlers: MarkerHandlers | null): void;
  /** Rang mis en avant (la rangée du composeur qu'on édite), ou `null`. */
  setActive(index: number | null): void;
  remove(): void;
}

const MARKER_CLASS =
  'absolute left-0 top-0 z-[5] flex h-5 w-5 items-center justify-center rounded-full border-2 text-xs font-semibold shadow';
/** Pastille au repos : elle ne doit pas voler le pointeur à l'orbite. */
const IDLE_CLASS = 'pointer-events-none border-background bg-primary text-primary-foreground';
/** Pastille manipulable — le curseur annonce qu'elle se tire. */
const LIVE_CLASS = 'cursor-grab border-background bg-primary text-primary-foreground';
/** Pastille du point en cours d'édition : le même jeu de tokens, en inverse. */
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

  /** Pastille de rang `i`, créée à la demande (un seul point = un seul nœud dans le DOM). */
  const elementAt = (i: number): HTMLDivElement => {
    let el = els[i];
    if (!el) {
      el = document.createElement('div');
      el.textContent = String(i + 1);
      el.style.display = 'none';
      // Rang publié sur la pastille : c'est par lui qu'un calque React s'y ancre (`poi/poiAnchor`)
      // pour suivre le point sans se reprojeter lui-même.
      el.setAttribute(POI_ANCHOR_ATTR, String(i));
      // Un seul jeu d'écouteurs par pastille, posé à la création : ils lisent `handlers` au
      // moment du geste, donc (dés)armer n'ajoute ni ne retire rien.
      let down: { x: number; y: number } | null = null;
      el.addEventListener('pointerdown', (e) => {
        if (!handlers || e.button !== 0) return;
        down = { x: e.clientX, y: e.clientY };
        // Le canvas ne doit ni orbiter ni poser un point de plus sous la pastille.
        e.stopPropagation();
        e.preventDefault();
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          // Pointeurs synthétiques sans capture (tests) : le geste reste fonctionnel.
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
