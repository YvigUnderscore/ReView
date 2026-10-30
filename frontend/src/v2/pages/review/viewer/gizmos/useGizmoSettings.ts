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
 * React state for the gizmo settings per target kind (11.G): loaded from localStorage on
 * mount, persisted on every update. `kind` designates the current target (the whole splat or
 * the active SDF volume) — both sets of settings coexist and are remembered separately.
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
