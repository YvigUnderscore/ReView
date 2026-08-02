// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Réglages du gizmo TRS contextualisés par cible (11.G) : le splat entier et les volumes de
 * crop ne se manipulent pas pareil — espace, snaps et taille de poignées sont mémorisés
 * séparément (localStorage) et survivent au rechargement.
 */

export type GizmoTargetKind = 'splat' | 'volume';

export interface GizmoSettings {
  space: 'local' | 'world';
  /** Pas d'accrochage translation (unités scène), null = libre. */
  translationSnap: number | null;
  /** Pas d'accrochage rotation (degrés), null = libre. */
  rotationSnapDeg: number | null;
  /** Pas d'accrochage échelle (facteur), null = libre. */
  scaleSnap: number | null;
  /** Taille des poignées du gizmo (TransformControls.size). */
  size: number;
}

export const DEFAULT_GIZMO_SETTINGS: Record<GizmoTargetKind, GizmoSettings> = {
  splat: { space: 'local', translationSnap: null, rotationSnapDeg: null, scaleSnap: null, size: 1 },
  // Volume : poignées plus discrètes (l'objet manipulé est petit devant la scène).
  volume: { space: 'local', translationSnap: null, rotationSnapDeg: null, scaleSnap: null, size: 0.75 },
};

const storageKey = (kind: GizmoTargetKind) => `review:splat:gizmo:${kind}`;

/** Charge les réglages mémorisés (fusionnés aux défauts — tolérant aux versions antérieures). */
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
    // Stockage indisponible (quota, navigation privée) : réglages de session seulement.
  }
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}
