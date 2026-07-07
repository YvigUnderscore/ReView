import { useCallback, useEffect, useRef, useState } from 'react';
import type * as THREE from 'three';
import type { SplatViewer } from '../../useSplat';
import type { EditOp } from '../operations/history';
import {
  createVolume,
  detachVolume,
  disposeVolume,
  reattachVolume,
  setVolumeMode,
  type VolumeMode,
  type VolumeRuntime,
  type VolumeShape,
} from './cropVolume';

/** Volume de crop tel que présenté à l'UI (les objets Three vivent dans un ref). */
export interface VolumeItem {
  id: number;
  shape: VolumeShape;
  mode: VolumeMode;
}

/**
 * Volumes de crop de l'éditeur de splat (10.G) : liste des volumes actifs, volume sélectionné
 * (le gizmo s'y attache pour le déplacer/tourner/redimensionner), bascule creuser/isoler,
 * ajout/retrait annulables (via l'historique fourni). Les objets Spark/Three vivent dans un
 * ref (`VolumeRuntime`) ; la sérialisation pour persistance arrive au chantier H5.
 */
export function useVolumes(splat: SplatViewer, pushHistory: (op: EditOp) => void) {
  const { getSceneHandle } = splat;
  const [volumes, setVolumes] = useState<VolumeItem[]>([]);
  // Volume actif (gizmo attaché à son SDF) — id + objet, posés ensemble dans les handlers
  // (pas de lecture du ref `runtimes` pendant le render, règle react-hooks/refs).
  const [active, setActive] = useState<{ id: number; sdf: THREE.Object3D } | null>(null);
  const runtimes = useRef(new Map<number, VolumeRuntime>());
  const nextId = useRef(1);

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
      pushHistory({
        label: 'Ajout de volume',
        undo: () => {
          detachVolume(runtime);
          setVolumes((v) => v.filter((x) => x.id !== id));
          setActive((a) => (a?.id === id ? null : a));
        },
        redo: () => {
          reattachVolume(handle, runtime);
          setVolumes((v) => [...v, item]);
          setActive({ id, sdf: runtime.sdf });
        },
      });
    },
    [getSceneHandle, pushHistory],
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
      pushHistory({
        label: 'Retrait de volume',
        undo: () => {
          reattachVolume(handle, runtime);
          setVolumes((v) => [...v, item]);
        },
        redo: () => {
          detachVolume(runtime);
          setVolumes((v) => v.filter((x) => x.id !== id));
          setActive((a) => (a?.id === id ? null : a));
        },
      });
    },
    [getSceneHandle, pushHistory, volumes],
  );

  /** Bascule creuser ↔ isoler (hors historique : réversible d'un clic). */
  const toggleMode = useCallback((id: number) => {
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
  }, []);

  /** Sélectionne (ou désélectionne) le volume — le gizmo s'attache à son SDF. */
  const select = useCallback((id: number) => {
    const runtime = runtimes.current.get(id);
    if (!runtime) return;
    setActive((a) => (a?.id === id ? null : { id, sdf: runtime.sdf }));
  }, []);

  // Démontage de l'éditeur : libération définitive de tous les volumes.
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
  };
}

export type VolumesState = ReturnType<typeof useVolumes>;
