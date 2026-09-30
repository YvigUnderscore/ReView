// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import { DEFAULT_REVIEW_ASPECT, reviewFrame } from '../frameRect';
import { resizeRendererCamera } from '../three/sceneConfig';
import { VIEWER_BACKDROP } from './thumbnail';

/**
 * Capture de vue des viewers spatiaux (3D, splat) — le bouton « Capture the view » du panneau
 * Export.
 *
 * POURQUOI. Le bouton servait la MINIATURE : `toThumbnail` réduit le canvas à 480 px de large et
 * l'encode en JPEG 0.72. C'est le bon gabarit pour une vignette de carte, pas pour une image
 * qu'on emporte dans une compo — d'où une capture « de très mauvaise qualité ». La capture prend
 * désormais un rendu **dédié** :
 *
 * - **au cadre de livraison**, pas au conteneur : `setViewOffset` étend la vue du cadre à tout
 *   l'écran (viewer plein espace, cf. `frameRect`) ; la capture efface cet offset et rend donc
 *   exactement ce que le guide letterbox délimite — le cadre annoté, sans les bandes ;
 * - **à la résolution de livraison plutôt qu'à celle de la fenêtre** : au moins
 *   `CAPTURE_MIN_WIDTH` de large (le rendu est suréchantillonné quand la fenêtre est plus
 *   petite), plafonnée par ce que le GPU sait allouer ;
 * - **en PNG**, sans perte ;
 * - **sans les repères d'écran** : la grille de sol se retire le temps de la pose (`userData`
 *   marqué `EXCLUDE_FROM_CAPTURE`). Elle est remise dans un `finally` — une capture qui échoue
 *   ne laisse pas la scène sans sa grille.
 *
 * La pièce logique (`captureSize`, `hideCaptureMarkers`, `renderViewCapture`) ne connaît ni
 * Three ni WebGL et se teste telle quelle ; `captureSceneView` n'est que le branchement.
 */

/** Largeur visée : en deçà, la capture suréchantillonne le rendu d'écran plutôt que de l'étirer. */
export const CAPTURE_MIN_WIDTH = 1920;

/** Plafond de sûreté : au-delà, l'allocation du tampon de dessin devient hasardeuse. */
export const CAPTURE_MAX_WIDTH = 4096;

export interface CaptureSize {
  width: number;
  height: number;
}

const usable = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * Résolution d'une capture : l'aspect du cadre de livraison, au moins `CAPTURE_MIN_WIDTH` de
 * large, plafonné par `maxWidth` (limite GPU). Pur.
 */
export function captureSize(frameWidth: number, aspect: number, maxWidth?: number): CaptureSize {
  const a = usable(aspect) ? aspect : DEFAULT_REVIEW_ASPECT;
  const ceiling = usable(maxWidth) ? Math.min(maxWidth, CAPTURE_MAX_WIDTH) : CAPTURE_MAX_WIDTH;
  const cap = Math.max(1, Math.floor(ceiling));
  let width = Math.min(Math.max(usable(frameWidth) ? Math.round(frameWidth) : 0, CAPTURE_MIN_WIDTH), cap);
  let height = Math.max(1, Math.round(width / a));
  // Format très haut (aspect < 1) : c'est la HAUTEUR qui touche le plafond, pas la largeur.
  if (height > cap) {
    height = cap;
    width = Math.max(1, Math.round(cap * a));
  }
  return { width: Math.max(1, width), height };
}

/** Clé `userData` d'un repère d'écran : visible dans le viewer, absent des captures. */
export const EXCLUDE_FROM_CAPTURE = 'rvExcludeFromCapture';

export interface CaptureObject {
  visible: boolean;
  userData?: Record<string, unknown>;
}

export interface CaptureScene {
  traverse(visit: (o: CaptureObject) => void): void;
}

/**
 * Retire les repères marqués de la scène le temps d'une pose. Renvoie de quoi les remettre — à
 * jouer dans un `finally`, sinon une capture en échec laisserait le viewer sans sa grille.
 */
export function hideCaptureMarkers(scene: CaptureScene): () => void {
  const hidden: CaptureObject[] = [];
  scene.traverse((o) => {
    if (o.visible && o.userData?.[EXCLUDE_FROM_CAPTURE] === true) {
      o.visible = false;
      hidden.push(o);
    }
  });
  return () => {
    for (const o of hidden) o.visible = true;
  };
}

export interface ViewCaptureDeps {
  /** Tampon de dessin courant (px) — mesure le cadre de livraison tel qu'il est à l'écran. */
  buffer: { width: number; height: number };
  scene: CaptureScene;
  aspect: number;
  /** Largeur maximale allouable (limite GPU) — repli `CAPTURE_MAX_WIDTH`. */
  maxWidth?: number;
  /** Rend une frame à la résolution demandée (renderer et caméra recalés par l'appelant). */
  renderAt: (size: CaptureSize) => void;
  /** Encode la frame rendue. */
  encode: () => string | null;
  /** Remet le rendu d'écran — TOUJOURS joué, que la capture ait abouti ou non. */
  restore: () => void;
}

/**
 * Pose une capture : masque les repères, rend à la résolution voulue, encode, puis remet la
 * scène et le rendu d'écran. Testable sans WebGL.
 */
export function renderViewCapture(deps: ViewCaptureDeps): string | null {
  const aspect = usable(deps.aspect) ? deps.aspect : DEFAULT_REVIEW_ASPECT;
  const frame = reviewFrame(aspect, deps.buffer.width, deps.buffer.height);
  const size = captureSize(frame.width, aspect, deps.maxWidth);
  const showMarkers = hideCaptureMarkers(deps.scene);
  try {
    deps.renderAt(size);
    return deps.encode();
  } catch {
    // Tampon non alloué, canvas « tainted », contexte perdu : pas d'image, mais scène intacte.
    return null;
  } finally {
    showMarkers();
    deps.restore();
  }
}

/**
 * PNG de la frame rendue, aplatie sur le fond du viewer : le renderer splat est en `alpha: true`
 * et une capture transparente ne montrerait pas ce que le spectateur a sous les yeux.
 */
export function toCapturePng(canvas: HTMLCanvasElement): string | null {
  const flat = document.createElement('canvas');
  flat.width = canvas.width;
  flat.height = canvas.height;
  const ctx = flat.getContext('2d');
  if (!ctx || !flat.width || !flat.height) return null;
  ctx.fillStyle = VIEWER_BACKDROP;
  ctx.fillRect(0, 0, flat.width, flat.height);
  ctx.drawImage(canvas, 0, 0);
  const url = flat.toDataURL('image/png');
  return url.startsWith('data:image/png') ? url : null;
}

/** Ce qu'il faut d'un viewer spatial pour capturer sa vue — satisfait par les deux scènes. */
export interface ViewCaptureScene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
}

/**
 * Capture la vue d'une scène montée. `onRestored` redemande une frame d'écran quand le viewer
 * rend à la demande : la remise en place repasse par `setSize`, qui vide le tampon de dessin.
 */
export function captureSceneView(
  s: ViewCaptureScene | null | undefined,
  aspect: number,
  onRestored?: () => void,
): string | null {
  if (!s) return null;
  const { renderer, scene, camera } = s;
  const canvas = renderer.domElement;
  // Un aspect aberrant ferait rendre `resizeRendererCamera` sans cadre au retour : on assainit
  // une fois, et la remise en place voit exactement l'aspect qui a servi à capturer.
  const a = usable(aspect) ? aspect : DEFAULT_REVIEW_ASPECT;
  // Taille logique du rendu d'écran, relevée AVANT de toucher au renderer : elle sert à le
  // remettre en place sans mesurer le DOM (le canvas est étiré en CSS, pas dimensionné par lui).
  const ratio = renderer.getPixelRatio();
  const screen = { w: Math.round(canvas.width / ratio), h: Math.round(canvas.height / ratio) };
  return renderViewCapture({
    buffer: { width: canvas.width, height: canvas.height },
    scene,
    aspect: a,
    maxWidth: renderer.capabilities?.maxTextureSize,
    renderAt: ({ width, height }) => {
      // `setSize` multiplie par le rapport de pixels : on le neutralise pour obtenir exactement
      // la résolution demandée, et on le rend dans `restore`.
      renderer.setPixelRatio(1);
      renderer.setSize(width, height, false);
      // Plus de sous-vue élargie : la capture rend le cadre de livraison, pas le conteneur.
      if (camera.view?.enabled) camera.clearViewOffset();
      camera.aspect = a;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    },
    encode: () => toCapturePng(canvas),
    restore: () => {
      renderer.setPixelRatio(ratio);
      resizeRendererCamera(renderer, camera, screen.w, screen.h, a);
      renderer.render(scene, camera); // `setSize` a vidé le tampon : on redessine tout de suite
      onRestored?.();
    },
  });
}

/**
 * Capture prête à brancher sur le bouton du panneau Export. Les accès sont paresseux : la scène
 * n'existe qu'après le montage asynchrone de Three, et l'aspect de livraison peut changer.
 */
export function viewCapturer(
  getScene: () => ViewCaptureScene | null | undefined,
  getAspect: () => number,
  onRestored?: () => void,
): () => string | null {
  return () => captureSceneView(getScene(), getAspect(), onRestored);
}
