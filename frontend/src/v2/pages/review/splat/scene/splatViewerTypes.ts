// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import type { Hotspot3D, SplatCamera, SplatTransform } from '../../reviewTypes';
import type { PipRect } from '../../viewer/pipWindow';
import type { RenderMode } from './renderModes';
import type { SplatStats } from './stats';
import type { SplatSceneCore } from './createScene';

/**
 * Contrats du viewer splat, sortis de `useSplat` (budget lignes) : l'état interne de la scène,
 * la poignée impérative passée à l'édition et l'API rendue à la page. `useSplat` les réexporte,
 * les nombreux appelants continuent donc d'importer depuis `../useSplat`.
 */
export type SplatScene = SplatSceneCore & {
  mesh: SplatMesh;
  pivot: THREE.Group;
  /** Caméra « layout » du PiP (mode layout, Phase 27) — pilotée par le lecteur keyframe. */
  layoutCam: THREE.PerspectiveCamera;
};

/**
 * Poignée impérative vers la scène Three.js du splat, exposée aux hooks d'édition (gizmos,
 * sélection). Les composants React de haut niveau n'y touchent pas — seule la couche `editor/`
 * consomme Three via cette poignée, gardant la séparation scène / édition.
 */
export interface SplatSceneHandle {
  THREE: typeof import('three');
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  mesh: SplatMesh;
  /** Parent du mesh portant le flip d'orientation à l'import (11.E) — les splats frères
   *  (comparaison A/B) doivent y être ajoutés pour hériter de la même convention d'axes. */
  pivot: THREE.Group;
  spark: SparkRenderer;
  dom: HTMLElement;
}

export interface SplatViewer {
  containerRef: React.RefObject<HTMLDivElement | null>;
  ready: boolean;
  loadError: boolean;
  /** Progression du téléchargement réseau du fichier splat (0..1) tant qu'il arrive, puis null
   *  une fois le fichier reçu (décodage + LOD en cours) — 41.B streaming léger. Alimente la
   *  barre de chargement pour ouvrir vite les grosses scènes (le LOD GPU reste géré ailleurs). */
  progress: number | null;
  captureCamera: () => SplatCamera | undefined;
  restoreCamera: (state: unknown) => void;
  /** Hotspot sur la surface au centre du viewer (raycast), sinon null si le rayon ne touche rien. */
  raycastCenter: () => Hotspot3D | null;
  /** Hotspot sur la surface **sous le pointeur** (coordonnées client) — pose au clic. */
  hotspotAtPointer: (clientX: number, clientY: number) => Hotspot3D | null;
  /** Affiche (ou masque si null) le marqueur de hotspot, projeté à l'écran à chaque frame. */
  showHotspot: (hs: Hotspot3D | null) => void;
  /** Capture le rendu courant en miniature JPEG (data URL) — résolu après le prochain rendu. */
  captureThumbnail: () => Promise<string | null>;
  /** PNG plein cadre de la vue courante (panneau Export) — `null` si la capture a échoué. */
  captureView: () => string | null;
  /** Applique une transformation TRS au splat — preview live des gizmos et au chargement. */
  applyTransform: (t: SplatTransform | null) => void;
  /** Flip d'orientation à l'import (11.E) : true (défaut) = convention .ply/.spz Y-down
   *  redressée (rotation π sur X du groupe parent) ; false = fichier laissé tel quel. */
  setBaseFlip: (flip: boolean) => void;
  /** Bascule le mode de visualisation (splats / ellipses gaussiennes / points). */
  setRenderMode: (mode: RenderMode) => void;
  /** Reflète la sélection courante dans l'overlay « points » (teinte) — no-op hors mode points. */
  reflectSelection: (selected: ReadonlySet<number>) => void;
  /** Reflète un (dé)masquage de splats dans l'overlay « points » — no-op hors mode points. */
  reflectHidden: (indices: Iterable<number>, hidden: boolean) => void;
  /** Reflète l'escamotage des volumes de crop dans l'overlay « points » (Phase 28) — no-op sinon. */
  reflectCropped: (indices: Iterable<number>) => void;
  /** Abonne un panneau aux stats de rendu (FPS, splats, draw calls) — mesurées si abonné. */
  subscribeStats: (cb: (stats: SplatStats) => void) => () => void;
  /** Abonne un callback à chaque frame rendue (dt en secondes) — animations caméra (V5). */
  subscribeFrame: (cb: (dt: number) => void) => () => void;
  /** Neutralise (défaut) ou rétablit le culling Spark (clipXY/maxPixelRadius) — réglage live. */
  setCullingOff: (off: boolean) => void;
  /** Vol en cours (clic droit + ZQSD) — les raccourcis d'édition doivent rester inertes (11.G). */
  isFlying: () => boolean;
  /** Rect de la fenêtre PiP (px CSS, origine haut-gauche) — non-null : 2ᵉ passe de rendu de la
   *  caméra layout dans ce rect (mode layout, Phase 27) ; null : PiP éteint. */
  setPipRect: (rect: PipRect | null) => void;
  /** Applique une pose (position/cible/fov/roll) à la caméra layout du PiP. */
  restorePipCamera: (state: unknown) => void;
  /** Poignée impérative vers la scène (pour les hooks d'édition), ou null si pas encore prête. */
  getSceneHandle: () => SplatSceneHandle | null;
  /** Canvas de rendu (auto-pause de l'animation caméra) — satisfait `CameraController`. */
  getDom: () => HTMLElement | null;
}

/**
 * Moitié « interaction » de `SplatViewer` : les poignées impératives que `useSplatHandles`
 * dérive des refs de scène. Composée par `Pick` — une seule définition de chaque champ.
 */
export type SplatHandles = Pick<
  SplatViewer,
  | 'raycastCenter'
  | 'hotspotAtPointer'
  | 'showHotspot'
  | 'captureThumbnail'
  | 'applyTransform'
  | 'setBaseFlip'
  | 'setRenderMode'
  | 'reflectSelection'
  | 'reflectHidden'
  | 'reflectCropped'
  | 'subscribeStats'
  | 'subscribeFrame'
  | 'setCullingOff'
  | 'isFlying'
  | 'setPipRect'
  | 'getSceneHandle'
  | 'getDom'
>;
