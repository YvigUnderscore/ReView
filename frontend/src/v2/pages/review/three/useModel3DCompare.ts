// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type * as THREE from 'three';
import { api } from '@/lib/apiClient';
import { qk } from '@/v2/lib/query';
import type { Media, MediaSummary, VersionDetail } from '@/v2/types/api';
import type { MediaResp } from '../reviewTypes';
import { loadModel, TARGET_SIZE } from './loadModel';
import { setObjectOpacity, sideBySideOffsets } from './modelCompare';
import { mergeCompareMedia, useCompareVersions } from './useCompareVersions';
import type { Model3DThreeState } from './useModel3DThree';
import { useT } from '@/v2/i18n';

const FADE_MS = 300;
const SLIDE_MS = 400;

/** Sibling 3D models (READY) of a list of version media (pure). */
export function model3dSiblings(media: MediaSummary[]): MediaSummary[] {
  return media.filter((m) => m.kind === 'MODEL_3D' && m.status === 'READY');
}

/**
 * A/B comparison of 3D models (39.E, parity with the splat A/B): the `MODEL_3D` siblings of the
 * current version **and the models ticked in other versions** are loaded into the **same scene**
 * (hence a **linked camera**) — A/B switch with a crossfade, or **"show all"** side by side with a
 * slide. Models are normalized (bbox → target size, bottom of bbox on `y = 0`) by `loadModel`, so
 * they are already at comparable sizes and **standing on the same ground** — the spacing only plays
 * on X; the viewer's real-size toggle answers the size question instead. Non-destructive: compared
 * models are loaded **raw** (without the persisted edits of their media) and released on unmount or
 * untick.
 */
export function useModel3DCompare(model3d: Model3DThreeState, current: Media) {
  const t = useT();
  const { getSceneHandle, subscribeFrame } = model3d;
  const versionQ = useQuery({
    queryKey: qk.version(current.versionId),
    queryFn: () =>
      api.get<{ version: VersionDetail }>(`/api/versions/${current.versionId}`).then((d) => d.version),
  });
  const versions = useCompareVersions();
  const models = mergeCompareMedia(model3dSiblings(versionQ.data?.media ?? []), versions.extras);
  const enabled = models.length > 1;
  const [mode, setMode] = useState<'single' | 'all'>('single');
  const [activeId, setActiveId] = useState(current.id);
  const [busy, setBusy] = useState(false);
  const siblingsRef = useRef(new Map<number, THREE.Object3D>());
  const opacityRef = useRef(new Map<number, number>());
  const baseXRef = useRef(new Map<number, number>());

  /** Opacity crossfade of an object (A/B), interpolated on the render loop. */
  const fade = useCallback(
    (id: number, object: THREE.Object3D, to: number) => {
      const from = opacityRef.current.get(id) ?? (id === current.id ? 1 : 0);
      if (from === to) return;
      let t = 0;
      const off = subscribeFrame((dt) => {
        t += dt * 1000;
        const u = Math.min(t / FADE_MS, 1);
        const v = from + (to - from) * u;
        opacityRef.current.set(id, v);
        setObjectOpacity(object, v);
        if (u >= 1) off();
      });
    },
    [subscribeFrame, current.id],
  );

  /** Slide of an object's X position toward its base + offset (side by side). */
  const slideX = useCallback(
    (id: number, object: THREE.Object3D, offset: number) => {
      const base = baseXRef.current.get(id) ?? object.position.x;
      baseXRef.current.set(id, base);
      const from = object.position.x;
      const to = base + offset;
      if (from === to) return;
      let t = 0;
      const off = subscribeFrame((dt) => {
        t += dt * 1000;
        const u = Math.min(t / SLIDE_MS, 1);
        const s = u * u * (3 - 2 * u); // smoothstep
        object.position.x = from + (to - from) * s;
        if (u >= 1) off();
      });
    },
    [subscribeFrame],
  );

  /** Loads (once) a sibling into the scene — normalized, under `root`, invisible at first. */
  const ensureSibling = useCallback(
    async (id: number): Promise<THREE.Object3D | null> => {
      const handle = getSceneHandle();
      if (!handle?.mesh) return null;
      const existing = siblingsRef.current.get(id);
      if (existing) return existing;
      const detail = await api.get<MediaResp>(`/api/media/${id}`);
      const src = detail.glbUrl ?? detail.url;
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      const loaded = await loadModel(handle.THREE, new GLTFLoader(), src);
      const object = loaded.object;
      setObjectOpacity(object, 0);
      handle.mesh.add(object); // child of `root`: aligned with the main model
      opacityRef.current.set(id, 0);
      baseXRef.current.set(id, object.position.x);
      siblingsRef.current.set(id, object);
      return object;
    },
    [getSceneHandle],
  );

  /** All objects in the scene: the main model + the loaded siblings. */
  const allObjects = useCallback((): [number, THREE.Object3D][] => {
    const handle = getSceneHandle();
    const out: [number, THREE.Object3D][] = [];
    if (handle?.modelObject) out.push([current.id, handle.modelObject]);
    for (const e of siblingsRef.current.entries()) out.push(e);
    return out;
  }, [getSceneHandle, current.id]);

  /** A/B switch: crossfade to the chosen model, the others switch off, positions restored. */
  const switchTo = useCallback(
    async (id: number) => {
      setBusy(true);
      try {
        if (id !== current.id && !(await ensureSibling(id))) return;
        for (const [mid, object] of allObjects()) {
          slideX(mid, object, 0);
          fade(mid, object, mid === id ? 1 : 0);
        }
        setActiveId(id);
        setMode('single');
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t('model3d.compareUnreachable'));
      } finally {
        setBusy(false);
      }
    },
    [current.id, ensureSibling, allObjects, fade, slideX, t],
  );

  /** "Show all": loads all siblings and spreads them side by side. */
  const viewAll = useCallback(async () => {
    setBusy(true);
    try {
      for (const m of models) if (m.id !== current.id) await ensureSibling(m.id);
      const spacing = TARGET_SIZE * 1.15; // normalized models at the same target size
      const offsets = sideBySideOffsets(models.length, spacing);
      const byId = new Map(allObjects());
      models.forEach((m, i) => {
        const object = byId.get(m.id);
        if (!object) return;
        fade(m.id, object, 1);
        slideX(m.id, object, offsets[i]);
      });
      setMode('all');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('model3d.loadFailed'));
    } finally {
      setBusy(false);
    }
  }, [models, current.id, ensureSibling, allObjects, fade, slideX, t]);

  /** Ticks a version: the model is loaded and shown right away (no extra step). */
  const addVersion = useCallback(
    (id: number, media?: MediaSummary) => {
      versions.add(id, media);
      void switchTo(id);
    },
    [versions, switchTo],
  );

  /** Unticks a version: back to the current model if it was the one displayed. */
  const removeVersion = useCallback(
    (id: number) => {
      versions.remove(id);
      if (activeId === id) void switchTo(current.id);
    },
    [versions, activeId, switchTo, current.id],
  );

  // Untick: the model removed from the list must leave the scene — otherwise it would stay loaded,
  // invisible in A/B but still present in "show all".
  const listedIds = models.map((m) => m.id).join(',');
  useEffect(() => {
    const kept = new Set(listedIds.split(',').map(Number));
    for (const [id, object] of siblingsRef.current) {
      if (kept.has(id)) continue;
      disposeObject(object);
      siblingsRef.current.delete(id);
      opacityRef.current.delete(id);
      baseXRef.current.delete(id);
    }
  }, [listedIds]);

  // Unmount: removes and frees the loaded siblings (the main model belongs to the viewer).
  useEffect(() => {
    const map = siblingsRef.current;
    return () => {
      map.forEach(disposeObject);
      map.clear();
    };
  }, []);

  return {
    enabled,
    models,
    mode,
    activeId,
    busy,
    switchTo,
    viewAll,
    /** Selection of other versions (feeds `CompareSelect`). */
    versions: { ids: versions.ids, add: addVersion, remove: removeVersion, set: versions.set },
  };
}

/** Frees geometries and materials of a compared model, then removes it from the scene. */
function disposeObject(object: THREE.Object3D): void {
  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose?.();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose?.();
  });
  object.removeFromParent();
}

export type Model3DCompareState = ReturnType<typeof useModel3DCompare>;
