// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * TRS gizmo settings, contextualised per target (11.G): the whole splat and the crop volumes
 * are not manipulated the same way — space, snaps and handle size are remembered separately
 * (localStorage) and survive a reload.
 */

export type GizmoTargetKind = 'splat' | 'volume';

export interface GizmoSettings {
  space: 'local' | 'world';
  /** Translation snap step (scene units), null = free. */
  translationSnap: number | null;
  /** Rotation snap step (degrees), null = free. */
  rotationSnapDeg: number | null;
  /** Scale snap step (factor), null = free. */
  scaleSnap: number | null;
  /** Gizmo handle size (TransformControls.size). */
  size: number;
}

export const DEFAULT_GIZMO_SETTINGS: Record<GizmoTargetKind, GizmoSettings> = {
  splat: { space: 'local', translationSnap: null, rotationSnapDeg: null, scaleSnap: null, size: 1 },
  // Volume: subtler handles (the manipulated object is small relative to the scene).
  volume: { space: 'local', translationSnap: null, rotationSnapDeg: null, scaleSnap: null, size: 0.75 },
};

const storageKey = (kind: GizmoTargetKind) => `review:splat:gizmo:${kind}`;

/** Loads the remembered settings (merged with the defaults — tolerant of older versions). */
export function loadGizmoSettings(kind: GizmoTargetKind): GizmoSettings {
  try {
    const raw = localStorage.getItem(storageKey(kind));
    if (!raw) return { ...DEFAULT_GIZMO_SETTINGS[kind] };
    const parsed = JSON.parse(raw) as Partial<GizmoSettings>;
    const base = DEFAULT_GIZMO_SETTINGS[kind];
    return {
      space: parsed.space === 'world' ? 'world' : 'local',
      translationSnap: numOrNull(parsed.translationSnap),
      rotationSnapDeg: numOrNull(parsed.rotationSnapDeg),
      scaleSnap: numOrNull(parsed.scaleSnap),
      size: typeof parsed.size === 'number' && parsed.size > 0 ? parsed.size : base.size,
    };
  } catch {
    return { ...DEFAULT_GIZMO_SETTINGS[kind] };
  }
}

export function saveGizmoSettings(kind: GizmoTargetKind, settings: GizmoSettings): void {
  try {
    localStorage.setItem(storageKey(kind), JSON.stringify(settings));
  } catch {
    // Storage unavailable (quota, private browsing): session-only settings.
  }
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}
