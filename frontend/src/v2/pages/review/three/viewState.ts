// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { DISPLAY_MODES, type DisplayMode } from './displayModes';
import type { SectionAxis } from './sectionPlane';
import { DEFAULT_LIGHTING, type LightingConfig } from '../reviewTypes';

/**
 * View state of the 3D viewer attached to a comment's camera view (`Comment.cameraState.view`).
 *
 * A comment used to capture the camera, the hotspot, the animation and the scene override — but
 * neither the display mode, nor the section plane, nor the lighting. "Look at what I see" was
 * therefore wrong as soon as the note was written in wireframe or with an open cut: the reader
 * found the right camera in front of a different image. We complete the captured state.
 *
 * An **optional and lenient** field: earlier comments carry none, and the server (non-strict Zod)
 * drops it from persisted presentations — a camera bookmark therefore never replays a display mode,
 * only the comment does.
 *
 * Pure and testable: reading/writing hooks live in `useModel3DViewState`.
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

/** Reads the view state attached to a camera view; `null` if the blob carries none. */
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
 * Equality of two view states. The live session replays the host's camera several times per
 * second: without this comparison, every packet would reapply the display mode and reload the HDRI
 * — the viewer's audience would flicker.
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
