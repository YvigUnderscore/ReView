// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { SplatMesh } from '@sparkjsdev/spark';
import { api } from '@/lib/apiClient';
import { qk } from '@/v2/lib/query';
import type { Media, MediaSummary, VersionDetail } from '@/v2/types/api';
import type { MediaResp } from '../../reviewTypes';
import { visibleLocalBox } from '../scene/visibleBounds';
import type { SplatSceneHandle, SplatViewer } from '../useSplat';
import { mergeCompareMedia, useCompareVersions } from '../../three/useCompareVersions';
import { normalizationFor, type SiblingNormalization } from './normalize';
import { useT } from '@/v2/i18n';

/**
 * Splat comparison (10.G-V8): the SPLAT siblings of the current version **and the splats ticked in other
 * versions** are loaded into the same scene (same camera): **A/B switch** with a crossfade, **"see all"**
 * side by side with a slide. Reuses the browser's version query (`qk.version`). With nothing to compare:
 * inactive (no-op). The compared splats are loaded raw (without their non-destructive edits): a comparative
 * objective. Their size is **unified by bounding box** on the reference splat (11.H), with a "Real size"
 * toggle to return to raw.
 */

/** Centred side-by-side offsets (pure): n positions spaced by `spacing`. */
export function sideBySideOffsets(n: number, spacing: number): number[] {
  return Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * spacing);
}

/** Visible SPLAT siblings of a list of version media (pure). */
export function splatSiblings(media: MediaSummary[]): MediaSummary[] {
  return media.filter((m) => m.kind === 'SPLAT' && m.status === 'READY');
}

const FADE_MS = 350;
const SLIDE_MS = 450;

/** Normalisation of a sibling against the reference splat (visible bboxes, pivot space): 11.H. */
function computeNormalization(handle: SplatSceneHandle, sibling: SplatMesh): SiblingNormalization | null {
  const { THREE, mesh } = handle;
  const refBox = visibleLocalBox(THREE, mesh);
  const sibBox = visibleLocalBox(THREE, sibling);
  if (!refBox || !sibBox) return null;
  // Reference in pivot space: local bbox passed through the mesh's user transform.
  mesh.updateMatrix();
  refBox.applyMatrix4(mesh.matrix);
  const refSphere = refBox.getBoundingSphere(new THREE.Sphere());
  const sibSphere = sibBox.getBoundingSphere(new THREE.Sphere());
  return normalizationFor(
    refSphere.radius,
    refSphere.center.toArray(),
    sibSphere.radius,
    sibSphere.center.toArray(),
  );
}

/** Applies (or removes) the normalisation to the sibling: raw scale and origin otherwise. */
function applyNormalization(mesh: SplatMesh, norm: SiblingNormalization | null, on: boolean): void {
  if (on && norm) {
    mesh.scale.setScalar(norm.scale);
    mesh.position.fromArray(norm.offset);
  } else {
    mesh.scale.setScalar(1);
    mesh.position.set(0, 0, 0);
  }
}

export function useSplatCompare(splat: SplatViewer, current: Media) {
  const t = useT();
  const { getSceneHandle, subscribeFrame } = splat;
  const versionQ = useQuery({
    queryKey: qk.version(current.versionId),
    queryFn: () =>
      api.get<{ version: VersionDetail }>(`/api/versions/${current.versionId}`).then((d) => d.version),
  });
  const versions = useCompareVersions();
  const splats = mergeCompareMedia(splatSiblings(versionQ.data?.media ?? []), versions.extras);
  const enabled = splats.length > 1;
  const [mode, setMode] = useState<'single' | 'all'>('single');
  const [activeId, setActiveId] = useState(current.id);
  const [busy, setBusy] = useState(false);
  // Sizes unified by bbox (11.H): active by default, "Real size" toggle.
  const [normalized, setNormalized] = useState(true);
  const siblingsRef = useRef(new Map<number, SplatMesh>());
  // Normalisation computed once per sibling (scale + recentring against the reference).
  const normRef = useRef(new Map<number, SiblingNormalization | null>());
  // Original X position of each mesh (the main one carries its recorded transform).
  const baseXRef = useRef(new Map<number, number>());

  /** Animates the opacity of a mesh (A/B crossfade). */
  const fade = useCallback(
    (mesh: { opacity: number }, to: number) => {
      const from = mesh.opacity;
      if (from === to) return;
      let t = 0;
      const off = subscribeFrame((dt) => {
        t += dt * 1000;
        const u = Math.min(t / FADE_MS, 1);
        mesh.opacity = from + (to - from) * u;
        if (u >= 1) off();
      });
    },
    [subscribeFrame],
  );

  /** Animates the X position of a mesh towards its base + offset (side-by-side slide). */
  const slideX = useCallback(
    (id: number, mesh: { position: { x: number } }, offset: number) => {
      const base = baseXRef.current.get(id) ?? mesh.position.x;
      baseXRef.current.set(id, base);
      const from = mesh.position.x;
      const to = base + offset;
      if (from === to) return;
      let t = 0;
      const off = subscribeFrame((dt) => {
        t += dt * 1000;
        const u = Math.min(t / SLIDE_MS, 1);
        const s = u * u * (3 - 2 * u); // smoothstep
        mesh.position.x = from + (to - from) * s;
        if (u >= 1) off();
      });
    },
    [subscribeFrame],
  );

  /** Loads (once) a sibling into the scene: raw, invisible at first. */
  const ensureSibling = useCallback(
    async (id: number): Promise<SplatMesh | null> => {
      const handle = getSceneHandle();
      if (!handle) return null;
      const existing = siblingsRef.current.get(id);
      if (existing) return existing;
      const detail = await api.get<MediaResp>(`/api/media/${id}`);
      const { SplatMesh } = await import('@sparkjsdev/spark');
      const mesh = new SplatMesh({ url: detail.url, fileName: detail.media.originalName });
      mesh.opacity = 0;
      // Child of the pivot (11.E): inherits the orientation flip, like the main splat.
      handle.pivot.add(mesh);
      await (mesh as unknown as { initialized?: Promise<unknown> }).initialized;
      // Size unified on the reference (11.H): remembered for the "Real size" toggle.
      const norm = computeNormalization(handle, mesh);
      normRef.current.set(id, norm);
      applyNormalization(mesh, norm, normalized);
      baseXRef.current.set(id, mesh.position.x);
      siblingsRef.current.set(id, mesh);
      return mesh;
    },
    [getSceneHandle, normalized],
  );

  /** All the meshes in the scene: the main one plus the loaded siblings. */
  const allMeshes = useCallback((): [number, SplatMesh][] => {
    const handle = getSceneHandle();
    if (!handle) return [];
    return [[current.id, handle.mesh], ...siblingsRef.current.entries()];
  }, [getSceneHandle, current.id]);

  /** A/B switch: crossfade to the chosen splat, the others switch off, positions restored. */
  const switchTo = useCallback(
    async (id: number) => {
      setBusy(true);
      try {
        if (id !== current.id && !(await ensureSibling(id))) return;
        for (const [mid, mesh] of allMeshes()) {
          slideX(mid, mesh, 0); // exit from "see all" mode
          fade(mesh, mid === id ? 1 : 0);
        }
        setActiveId(id);
        setMode('single');
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t('compare.siblingUnreachable'));
      } finally {
        setBusy(false);
      }
    },
    [current.id, ensureSibling, allMeshes, fade, slideX, t],
  );

  /** "See all": loads all the siblings and spreads them side by side. */
  const viewAll = useCallback(async () => {
    setBusy(true);
    try {
      const handle = getSceneHandle();
      if (!handle) return;
      for (const m of splats) if (m.id !== current.id) await ensureSibling(m.id);
      // Spacing = largest displayed width (visible bbox × applied scale, 11.H): with normalisation active,
      // all widths are close to the reference.
      let spacing = 2;
      let maxWidth = 0;
      for (const m of splats) {
        const mesh = m.id === current.id ? handle.mesh : siblingsRef.current.get(m.id);
        if (!mesh) continue;
        const box = visibleLocalBox(handle.THREE, mesh);
        if (box) maxWidth = Math.max(maxWidth, (box.max.x - box.min.x) * Math.abs(mesh.scale.x));
      }
      if (maxWidth > 0) spacing = maxWidth * 1.15;
      const offsets = sideBySideOffsets(splats.length, spacing);
      splats.forEach((m, i) => {
        const mesh = m.id === current.id ? handle.mesh : siblingsRef.current.get(m.id);
        if (!mesh) return;
        fade(mesh, 1);
        slideX(m.id, mesh, offsets[i]);
      });
      setMode('all');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('compare.loadFailed'));
    } finally {
      setBusy(false);
    }
  }, [getSceneHandle, splats, current.id, ensureSibling, fade, slideX, t]);

  /** "Real size" toggle (11.H): switches between normalisation and raw scales for all the siblings. */
  const toggleNormalized = useCallback(() => {
    const next = !normalized;
    setNormalized(next);
    for (const [id, mesh] of siblingsRef.current) {
      applyNormalization(mesh, normRef.current.get(id) ?? null, next);
      baseXRef.current.set(id, mesh.position.x);
    }
    // In "see all" mode, respread with the new spacing (the widths have changed).
    if (mode === 'all') void viewAll();
  }, [normalized, mode, viewAll]);

  /** Ticks a version: the splat is loaded and displayed at once. */
  const addVersion = useCallback(
    (id: number, media?: MediaSummary) => {
      versions.add(id, media);
      void switchTo(id);
    },
    [versions, switchTo],
  );

  /** Unticks a version: back to the current splat if it was the one displayed. */
  const removeVersion = useCallback(
    (id: number) => {
      versions.remove(id);
      if (activeId === id) void switchTo(current.id);
    },
    [versions, activeId, switchTo, current.id],
  );

  // Unticking: the splat removed from the list leaves the scene (it would otherwise remain loaded).
  const listedIds = splats.map((m) => m.id).join(',');
  useEffect(() => {
    const kept = new Set(listedIds.split(',').map(Number));
    for (const [id, mesh] of siblingsRef.current) {
      if (kept.has(id)) continue;
      disposeMesh(mesh);
      siblingsRef.current.delete(id);
      normRef.current.delete(id);
      baseXRef.current.delete(id);
    }
  }, [listedIds]);

  // Unmount: removes and frees the loaded siblings (the main one belongs to the viewer).
  useEffect(() => {
    const map = siblingsRef.current;
    return () => {
      map.forEach(disposeMesh);
      map.clear();
    };
  }, []);

  return {
    enabled,
    splats,
    mode,
    activeId,
    busy,
    normalized,
    toggleNormalized,
    switchTo,
    viewAll,
    /** Selection of other versions (feeds `CompareSelect`). */
    versions: { ids: versions.ids, add: addVersion, remove: removeVersion, set: versions.set },
  };
}

/** Frees a compared splat and removes it from the scene. */
function disposeMesh(mesh: SplatMesh): void {
  (mesh as unknown as { dispose?: () => void }).dispose?.();
  mesh.removeFromParent();
}

export type SplatCompareState = ReturnType<typeof useSplatCompare>;
