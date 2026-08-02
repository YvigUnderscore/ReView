// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type * as THREE from 'three';
import { api } from '../../../../lib/apiClient';
import { qk } from '../../../lib/query';
import type { Media, MediaSummary, VersionDetail } from '../../../types/api';
import type { MediaResp } from '../reviewTypes';
import { loadModel, TARGET_SIZE } from './loadModel';
import { setObjectOpacity, sideBySideOffsets } from './modelCompare';
import type { Model3DThreeState } from './useModel3DThree';

const FADE_MS = 300;
const SLIDE_MS = 400;

/** Modèles 3D frères (READY) d'une liste de médias de version (pur). */
export function model3dSiblings(media: MediaSummary[]): MediaSummary[] {
  return media.filter((m) => m.kind === 'MODEL_3D' && m.status === 'READY');
}

/**
 * Comparaison A/B des modèles 3D d'une même version (39.E, parité avec l'A/B splat) : si la version
 * porte plusieurs médias `MODEL_3D`, charge les frères dans la **même scène** (donc **caméra liée**)
 * — bascule A/B en fondu, ou **« voir tous »** côte à côte avec glissement. Les modèles sont
 * normalisés (bbox → taille cible) par `loadModel`, donc déjà à des tailles comparables. Non
 * destructif : les frères sont chargés bruts et libérés au démontage.
 */
export function useModel3DCompare(model3d: Model3DThreeState, current: Media) {
  const { getSceneHandle, subscribeFrame } = model3d;
  const versionQ = useQuery({
    queryKey: qk.version(current.versionId),
    queryFn: () =>
      api.get<{ version: VersionDetail }>(`/api/versions/${current.versionId}`).then((d) => d.version),
  });
  const models = model3dSiblings(versionQ.data?.media ?? []);
  const enabled = models.length > 1;
  const [mode, setMode] = useState<'single' | 'all'>('single');
  const [activeId, setActiveId] = useState(current.id);
  const [busy, setBusy] = useState(false);
  const siblingsRef = useRef(new Map<number, THREE.Object3D>());
  const opacityRef = useRef(new Map<number, number>());
  const baseXRef = useRef(new Map<number, number>());

  /** Fondu de l'opacité d'un objet (A/B), interpolé sur la boucle de rendu. */
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

  /** Glissement de la position X d'un objet vers sa base + offset (côte à côte). */
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

  /** Charge (une fois) un frère dans la scène — normalisé, sous `root`, invisible au départ. */
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
      handle.mesh.add(object); // enfant de `root` : aligné avec le modèle principal
      opacityRef.current.set(id, 0);
      baseXRef.current.set(id, object.position.x);
      siblingsRef.current.set(id, object);
      return object;
    },
    [getSceneHandle],
  );

  /** Tous les objets en scène : le modèle principal + les frères chargés. */
  const allObjects = useCallback((): [number, THREE.Object3D][] => {
    const handle = getSceneHandle();
    const out: [number, THREE.Object3D][] = [];
    if (handle?.modelObject) out.push([current.id, handle.modelObject]);
    for (const e of siblingsRef.current.entries()) out.push(e);
    return out;
  }, [getSceneHandle, current.id]);

  /** Bascule A/B : fondu vers le modèle choisi, les autres s'éteignent, positions restaurées. */
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
        toast.error(e instanceof Error ? e.message : 'Modèle de comparaison inaccessible');
      } finally {
        setBusy(false);
      }
    },
    [current.id, ensureSibling, allObjects, fade, slideX],
  );

  /** « Voir tous » : charge tous les frères et les écarte côte à côte. */
  const viewAll = useCallback(async () => {
    setBusy(true);
    try {
      for (const m of models) if (m.id !== current.id) await ensureSibling(m.id);
      const spacing = TARGET_SIZE * 1.15; // modèles normalisés à la même taille cible
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
      toast.error(e instanceof Error ? e.message : 'Chargement des modèles impossible');
    } finally {
      setBusy(false);
    }
  }, [models, current.id, ensureSibling, allObjects, fade, slideX]);

  // Démontage : retire et libère les frères chargés (le modèle principal appartient au viewer).
  useEffect(() => {
    const map = siblingsRef.current;
    return () => {
      map.forEach((object) => {
        object.traverse((o) => {
          const mesh = o as THREE.Mesh;
          mesh.geometry?.dispose?.();
          const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat?.dispose?.();
        });
        object.removeFromParent();
      });
      map.clear();
    };
  }, []);

  return { enabled, models, mode, activeId, busy, switchTo, viewAll };
}

export type Model3DCompareState = ReturnType<typeof useModel3DCompare>;
