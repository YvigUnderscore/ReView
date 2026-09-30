// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useState } from 'react';
import {
  loadGizmoSettings,
  saveGizmoSettings,
  type GizmoSettings,
  type GizmoTargetKind,
} from './gizmoSettings';

/**
 * État React des réglages du gizmo par type de cible (11.G) : chargés du localStorage au
 * montage, persistés à chaque mise à jour. `kind` désigne la cible courante (splat entier ou
 * volume SDF actif) — les deux jeux de réglages coexistent et se mémorisent séparément.
 */
export function useGizmoSettings(kind: GizmoTargetKind): {
  kind: GizmoTargetKind;
  settings: GizmoSettings;
  update: (patch: Partial<GizmoSettings>) => void;
} {
  const [all, setAll] = useState<Record<GizmoTargetKind, GizmoSettings>>(() => ({
    splat: loadGizmoSettings('splat'),
    volume: loadGizmoSettings('volume'),
  }));
  const update = useCallback(
    (patch: Partial<GizmoSettings>) => {
      setAll((prev) => {
        const next = { ...prev, [kind]: { ...prev[kind], ...patch } };
        saveGizmoSettings(kind, next[kind]);
        return next;
      });
    },
    [kind],
  );
  return { kind, settings: all[kind], update };
}
