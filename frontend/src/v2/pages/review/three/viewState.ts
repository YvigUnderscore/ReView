// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { DISPLAY_MODES, type DisplayMode } from './displayModes';
import type { SectionAxis } from './sectionPlane';
import { DEFAULT_LIGHTING, type LightingConfig } from '../reviewTypes';

/**
 * État de vue du viewer 3D joint à la vue caméra d'un commentaire (`Comment.cameraState.view`).
 *
 * Un commentaire capturait la caméra, le hotspot, l'animation et l'override de scène — mais
 * ni le mode d'affichage, ni le plan de coupe, ni l'éclairage. « Regarde ce que je vois »
 * était donc faux dès qu'on écrivait la note en wireframe ou une coupe ouverte : le lecteur
 * retrouvait la bonne caméra devant une image différente. On complète l'état capturé.
 *
 * Champ **optionnel et tolérant** : les commentaires antérieurs n'en portent pas, et le
 * serveur (Zod non strict) le laisse tomber des présentations persistées — un bookmark caméra
 * ne rejoue donc jamais un mode d'affichage, seul le commentaire le fait.
 *
 * Pur et testable : la lecture/écriture des hooks vit dans `useModel3DViewState`.
 */
export interface SectionState {
  active: boolean;
  axis: SectionAxis;
  position: number;
  flip: boolean;
}

export interface ReviewViewState {
  display: DisplayMode;
  section: SectionState;
  lighting: LightingConfig;
}

const AXES: SectionAxis[] = ['x', 'y', 'z'];

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

/** Relit l'état de vue attaché à une vue caméra ; `null` si le blob n'en porte pas. */
export function readViewState(cameraState: unknown): ReviewViewState | null {
  if (!cameraState || typeof cameraState !== 'object') return null;
  const raw = (cameraState as { view?: unknown }).view;
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as { display?: unknown; section?: unknown; lighting?: unknown };
  const section = (v.section ?? {}) as Partial<SectionState>;
  const lighting = (v.lighting ?? {}) as Partial<LightingConfig>;
  return {
    display: DISPLAY_MODES.includes(v.display as DisplayMode) ? (v.display as DisplayMode) : 'shaded',
    section: {
      active: section.active === true,
      axis: AXES.includes(section.axis as SectionAxis) ? (section.axis as SectionAxis) : 'x',
      position: num(section.position, 0),
      flip: section.flip === true,
    },
    lighting: {
      ...DEFAULT_LIGHTING,
      hdriId: typeof lighting.hdriId === 'string' ? lighting.hdriId : undefined,
      exposure: num(lighting.exposure, DEFAULT_LIGHTING.exposure),
      rotationDeg: num(lighting.rotationDeg, DEFAULT_LIGHTING.rotationDeg),
      showBackground: lighting.showBackground === true,
      groundShadow: lighting.groundShadow === true,
    },
  };
}

/**
 * Égalité de deux états de vue. La session live rejoue la caméra de l'hôte plusieurs fois par
 * seconde : sans cette comparaison, chaque paquet réappliquerait le mode d'affichage et
 * relancerait le chargement de l'HDRI — le viewer du spectateur clignoterait.
 */
export function sameViewState(a: ReviewViewState | null, b: ReviewViewState | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.display === b.display &&
    a.section.active === b.section.active &&
    a.section.axis === b.section.axis &&
    a.section.position === b.section.position &&
    a.section.flip === b.section.flip &&
    a.lighting.hdriId === b.lighting.hdriId &&
    a.lighting.exposure === b.lighting.exposure &&
    a.lighting.rotationDeg === b.lighting.rotationDeg &&
    a.lighting.showBackground === b.lighting.showBackground &&
    a.lighting.groundShadow === b.lighting.groundShadow
  );
}
