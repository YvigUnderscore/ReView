// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import type * as THREE from 'three';
import type { ViewerSceneHandle } from '../viewer/sceneHandle';
import { useSpatialContextMenu } from '../viewer/useSpatialContextMenu';
import { useUsdPicking } from './useUsdPicking';

/** What the hook expects from the 3D viewer: its scene and its canvas. */
interface PrimPointerViewer {
  getSceneHandle: () => ViewerSceneHandle | null;
  getDom: () => HTMLElement | null;
}

/**
 * The two pointer gestures of the 3D viewer, mounted together because they share the same prim
 * resolution: **left click without moving** = selection (`useUsdPicking`), **brief right click** =
 * menu of the targeted prim. The held right click belongs to flight — `viewer/useSpatialContextMenu`,
 * shared with the splat, tells the two apart on release.
 *
 * What is specific to the 3D model comes down to two rules: in empty space, **no menu** (all its
 * entries concern a prim), and the targeted prim also goes into the selection — we act on what is
 * seen highlighted. The path is rendered as state, not as a callback: the `ContextMenu` wrapping the
 * pane must populate its content at render time, before Radix opens it.
 */
export function usePrimPointer(
  viewer: PrimPointerViewer,
  ready: boolean,
  select: (path: string | null, opts?: { additive?: boolean }) => void,
  /** Viewer resolver: promotion to the enclosing component, `exact` for the leaf (Alt+click). */
  resolvePick: (object: THREE.Object3D, opts?: { exact?: boolean }) => string | null,
): string | null {
  const [path, setPath] = useState<string | null>(null);
  const pickAt = useUsdPicking(viewer.getSceneHandle, ready, select, resolvePick);
  useSpatialContextMenu(viewer.getDom, ready, (tap) => {
    const hit = pickAt(tap.clientX, tap.clientY, tap.altKey);
    if (!hit) return false;
    select(hit);
    setPath(hit);
    return true;
  });
  return path;
}
