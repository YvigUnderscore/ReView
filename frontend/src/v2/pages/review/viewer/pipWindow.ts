// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';

/** Rectangle du PiP en pixels CSS, origine **haut-gauche** du conteneur (coords DOM). */
export interface PipRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Largeur minimale de la fenêtre PiP (px CSS) — en dessous, le contenu devient illisible. */
export const PIP_MIN_WIDTH = 120;
const DEFAULT_FRAC = 0.28;
const MARGIN = 10;

/** Position par défaut : coin bas-droit, largeur = 28 % du conteneur, hauteur selon l'aspect. */
export function defaultPipRect(cw: number, ch: number, aspect: number): PipRect {
  const w = Math.round(cw * DEFAULT_FRAC);
  const rect = clampPipRect({ x: cw, y: ch, w, h: Math.round(w / aspect) }, cw, ch, aspect);
  return { ...rect, x: Math.max(0, cw - rect.w - MARGIN), y: Math.max(0, ch - rect.h - MARGIN) };
}

/**
 * Contraint un rect PiP au conteneur : largeur bornée (mini lisible, maxi = conteneur),
 * hauteur asservie à l'aspect (fenêtre = cadre de la caméra), position ramenée à l'intérieur.
 */
export function clampPipRect(rect: PipRect, cw: number, ch: number, aspect: number): PipRect {
  let w = Math.min(Math.max(rect.w, PIP_MIN_WIDTH), Math.max(cw - 2 * MARGIN, PIP_MIN_WIDTH));
  // La hauteur suit l'aspect ; si elle déborde du conteneur, la largeur est réduite d'autant.
  if (Math.round(w / aspect) > ch - 2 * MARGIN && ch > 2 * MARGIN)
    w = Math.max(Math.round((ch - 2 * MARGIN) * aspect), 1);
  const h = Math.max(Math.round(w / aspect), 1);
  const x = Math.min(Math.max(rect.x, 0), Math.max(cw - w, 0));
  const y = Math.min(Math.max(rect.y, 0), Math.max(ch - h, 0));
  return { x, y, w: Math.round(w), h };
}

/** Convertit un rect DOM (origine haut-gauche) en rect GL (origine bas-gauche) pour le scissor. */
export function toGlRect(rect: PipRect, ch: number): PipRect {
  return { x: rect.x, y: ch - rect.y - rect.h, w: rect.w, h: rect.h };
}

/**
 * 2ᵉ passe de rendu du PiP (vue de la caméra layout) : scissor + viewport sur le rect de la
 * fenêtre, profondeur seule effacée (le fond reste le rendu principal), puis restauration du
 * viewport plein cadre. Partagée par les viewers 3D et splat (Phase 27 — lot F).
 */
export function renderPipPass(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  rect: PipRect,
  cw: number,
  ch: number,
): void {
  if (rect.w <= 0 || rect.h <= 0 || cw <= 0 || ch <= 0) return;
  const gl = toGlRect(rect, ch);
  camera.aspect = rect.w / rect.h;
  camera.updateProjectionMatrix();
  renderer.setScissorTest(true);
  renderer.setScissor(gl.x, gl.y, gl.w, gl.h);
  renderer.setViewport(gl.x, gl.y, gl.w, gl.h);
  renderer.autoClear = false;
  renderer.clearDepth(); // scissor actif → n'efface la profondeur que dans le PiP
  renderer.render(scene, camera);
  renderer.autoClear = true;
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, cw, ch);
}
