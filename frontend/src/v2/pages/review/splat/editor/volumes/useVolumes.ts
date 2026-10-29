// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState } from 'react';
import type * as THREE from 'three';
import type { SdfVolumeData } from '../../../reviewTypes';
import type { SplatViewer } from '../../useSplat';
import { readMeshTransform } from '../../../viewer/gizmos/meshTransform';
import type { EditOp } from '../operations/history';
import { t } from '../../../../../i18n';
import {
  applyVolumeData,
  createVolume,
  detachVolume,
  disposeVolume,
  reattachVolume,
  setVolumeMode,
  type VolumeMode,
  type VolumeRuntime,
  type VolumeShape,
} from './cropVolume';

/** Crop volume as presented to the UI (the Three objects live in a ref). */
export interface VolumeItem {
  id: number;
  shape: VolumeShape;
  mode: VolumeMode;
}

/**
 * Crop volumes of the splat editor (10.G): list of active volumes, selected volume (the gizmo
 * attaches to it to move, rotate and resize it), carve/isolate toggle, and undoable add/remove
 * (via the supplied history). The Spark/Three objects live in a ref (`VolumeRuntime`);
 * serialization for persistence arrives in workstream H5.
 */
export function useVolumes(
  splat: SplatViewer,
  pushHistory: (op: EditOp) => void,
  onChanged: () => void,
  /** Persisted volumes to recreate when the editor loads (null = none). */
  initial: SdfVolumeData[] | null,
) {
  const { getSceneHandle, ready } = splat;
  const [volumes, setVolumes] = useState<VolumeItem[]>([]);
  // Active volume (gizmo attached to its SDF): id and object, set together in the handlers
  // (no reading of the `runtimes` ref during render, react-hooks/refs rule).
  const [active, setActive] = useState<{ id: number; sdf: THREE.Object3D } | null>(null);
  const runtimes = useRef(new Map<number, VolumeRuntime>());
  const nextId = useRef(1);
  const initedRef = useRef(false);

  // Recreates the persisted volumes (once the viewer is ready): outside the history, without dirty.
  useEffect(() => {
    if (initedRef.current || !ready || !initial?.length) return;
    initedRef.current = true;
    const handle = getSceneHandle();
    if (!handle) return;
    void (async () => {
      const items: VolumeItem[] = [];
      for (const data of initial) {
        const id = nextId.current++;
        const runtime = await createVolume(handle, data.shape, data.mode, true);
        applyVolumeData(runtime, data);
        runtimes.current.set(id, runtime);
        items.push({ id, shape: data.shape, mode: data.mode });
      }
      setVolumes((v) => [...v, ...items]);
    })();
  }, [ready, initial, getSceneHandle]);

  const add = useCallback(
    async (shape: VolumeShape) => {
      const handle = getSceneHandle();
      if (!handle) return;
      const id = nextId.current++;
      const runtime = await createVolume(handle, shape, 'delete');
      runtimes.current.set(id, runtime);
      const item: VolumeItem = { id, shape, mode: 'delete' };
      setVolumes((v) => [...v, item]);
      setActive({ id, sdf: runtime.sdf });
      onChanged();
      pushHistory({
        label: t('splat.undoVolumeAdd'),
        undo: () => {
          detachVolume(runtime);
          setVolumes((v) => v.filter((x) => x.id !== id));
          setActive((a) => (a?.id === id ? null : a));
          onChanged();
        },
        redo: () => {
          reattachVolume(handle, runtime);
          setVolumes((v) => [...v, item]);
          setActive({ id, sdf: runtime.sdf });
          onChanged();
        },
      });
    },
    [getSceneHandle, pushHistory, onChanged],
  );

  const remove = useCallback(
    (id: number) => {
      const handle = getSceneHandle();
      const runtime = runtimes.current.get(id);
      if (!handle || !runtime) return;
      const item = volumes.find((v) => v.id === id);
      if (!item) return;
      detachVolume(runtime);
      setVolumes((v) => v.filter((x) => x.id !== id));
      setActive((a) => (a?.id === id ? null : a));
      onChanged();
      pushHistory({
        label: t('splat.undoVolumeRemove'),
        undo: () => {
          reattachVolume(handle, runtime);
          setVolumes((v) => [...v, item]);
          onChanged();
        },
        redo: () => {
          detachVolume(runtime);
          setVolumes((v) => v.filter((x) => x.id !== id));
          setActive((a) => (a?.id === id ? null : a));
          onChanged();
        },
      });
    },
    [getSceneHandle, pushHistory, volumes, onChanged],
  );

  /** Carve ↔ isolate toggle (outside the history: reversible in one click). */
  const toggleMode = useCallback(
    (id: number) => {
      const runtime = runtimes.current.get(id);
      if (!runtime) return;
      setVolumes((v) =>
        v.map((x) => {
          if (x.id !== id) return x;
          const mode: VolumeMode = x.mode === 'delete' ? 'isolate' : 'delete';
          setVolumeMode(runtime, mode);
          return { ...x, mode };
        }),
      );
      onChanged();
    },
    [onChanged],
  );

  /** Serializes the volumes (local TRS of the SDF, shape and mode) for persistence (H5). */
  const serialize = useCallback(
    (): SdfVolumeData[] =>
      volumes.flatMap((v) => {
        const runtime = runtimes.current.get(v.id);
        if (!runtime) return [];
        return [{ shape: v.shape, mode: v.mode, ...readMeshTransform(runtime.sdf) }];
      }),
    [volumes],
  );

  /** Selects (or deselects) the volume: the gizmo attaches to its SDF. */
  const select = useCallback((id: number) => {
    const runtime = runtimes.current.get(id);
    if (!runtime) return;
    setActive((a) => (a?.id === id ? null : { id, sdf: runtime.sdf }));
  }, []);

  // Editor unmount: final release of all volumes.
  useEffect(() => {
    const map = runtimes.current;
    return () => {
      map.forEach(disposeVolume);
      map.clear();
    };
  }, []);

  return {
    volumes,
    activeId: active?.id ?? null,
    activeSdf: active?.sdf ?? null,
    add,
    remove,
    toggleMode,
    select,
    serialize,
    /**
     * Live Three objects, by identifier: read by the editor's suspension (lot 14), which detaches
     * them from the scene while a comment shows its own, then gives them back.
     */
    runtimesRef: runtimes,
  };
}

export type VolumesState = ReturnType<typeof useVolumes>;
