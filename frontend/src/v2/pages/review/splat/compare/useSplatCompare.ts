// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { SplatMesh } from '@sparkjsdev/spark';
import { api } from '../../../../../lib/apiClient';
import { qk } from '../../../../lib/query';
import type { Media, MediaSummary, VersionDetail } from '../../../../types/api';
import type { MediaResp } from '../../reviewTypes';
import { visibleLocalBox } from '../scene/visibleBounds';
import type { SplatSceneHandle, SplatViewer } from '../useSplat';
import { normalizationFor, type SiblingNormalization } from './normalize';
import { useT } from '../../../../i18n';

/**
 * Comparaison des splats d'une même version (10.G-V8) : si la version porte plusieurs médias
 * SPLAT, charge les frères dans la même scène (même caméra) — **switch A/B** avec fondu,
 * **« voir tous »** côte à côte avec glissement. Réutilise la query de version du navigateur
 * (`qk.version`). Mono-média : inactif (no-op). Les frères sont chargés bruts (sans leurs
 * éditions non-destructives) — objectif comparatif. Leur taille est **unifiée par bounding
 * box** sur le splat de référence (11.H), toggle « Taille réelle » pour revenir au brut.
 */

/** Décalages côte à côte centrés (pur) : n positions espacées de `spacing`. */
export function sideBySideOffsets(n: number, spacing: number): number[] {
  return Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * spacing);
}

/** Frères SPLAT visibles d'une liste de médias de version (pur). */
export function splatSiblings(media: MediaSummary[]): MediaSummary[] {
  return media.filter((m) => m.kind === 'SPLAT' && m.status === 'READY');
}

const FADE_MS = 350;
const SLIDE_MS = 450;

/** Normalisation d'un frère vs le splat de référence (bbox visibles, espace pivot) — 11.H. */
function computeNormalization(handle: SplatSceneHandle, sibling: SplatMesh): SiblingNormalization | null {
  const { THREE, mesh } = handle;
  const refBox = visibleLocalBox(THREE, mesh);
  const sibBox = visibleLocalBox(THREE, sibling);
  if (!refBox || !sibBox) return null;
  // Référence en espace pivot : bbox locale passée par la transform utilisateur du mesh.
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

/** Applique (ou retire) la normalisation au frère — échelle brute et origine sinon. */
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
  const splats = splatSiblings(versionQ.data?.media ?? []);
  const enabled = splats.length > 1;
  const [mode, setMode] = useState<'single' | 'all'>('single');
  const [activeId, setActiveId] = useState(current.id);
  const [busy, setBusy] = useState(false);
  // Tailles unifiées par bbox (11.H) — actif par défaut, toggle « Taille réelle ».
  const [normalized, setNormalized] = useState(true);
  const siblingsRef = useRef(new Map<number, SplatMesh>());
  // Normalisation calculée une fois par frère (échelle + recentrage vs la référence).
  const normRef = useRef(new Map<number, SiblingNormalization | null>());
  // Position X d'origine de chaque mesh (le principal porte sa transform enregistrée).
  const baseXRef = useRef(new Map<number, number>());

  /** Anime l'opacité d'un mesh (fondu A/B). */
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

  /** Anime la position X d'un mesh vers sa base + offset (glissement côte à côte). */
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

  /** Charge (une fois) un frère dans la scène — brut, invisible au départ. */
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
      // Enfant du pivot (11.E) : hérite du flip d'orientation, comme le splat principal.
      handle.pivot.add(mesh);
      await (mesh as unknown as { initialized?: Promise<unknown> }).initialized;
      // Taille unifiée sur la référence (11.H) — mémorisée pour le toggle « Taille réelle ».
      const norm = computeNormalization(handle, mesh);
      normRef.current.set(id, norm);
      applyNormalization(mesh, norm, normalized);
      baseXRef.current.set(id, mesh.position.x);
      siblingsRef.current.set(id, mesh);
      return mesh;
    },
    [getSceneHandle, normalized],
  );

  /** Tous les meshes en scène : le principal + les frères chargés. */
  const allMeshes = useCallback((): [number, SplatMesh][] => {
    const handle = getSceneHandle();
    if (!handle) return [];
    return [[current.id, handle.mesh], ...siblingsRef.current.entries()];
  }, [getSceneHandle, current.id]);

  /** Bascule A/B : fondu vers le splat choisi, les autres s'éteignent, positions restaurées. */
  const switchTo = useCallback(
    async (id: number) => {
      setBusy(true);
      try {
        if (id !== current.id && !(await ensureSibling(id))) return;
        for (const [mid, mesh] of allMeshes()) {
          slideX(mid, mesh, 0); // sortie du mode « voir tous »
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

  /** « Voir tous » : charge tous les frères et les écarte côte à côte. */
  const viewAll = useCallback(async () => {
    setBusy(true);
    try {
      const handle = getSceneHandle();
      if (!handle) return;
      for (const m of splats) if (m.id !== current.id) await ensureSibling(m.id);
      // Espacement = plus grande largeur affichée (bbox visible × échelle appliquée, 11.H) —
      // avec la normalisation active, toutes les largeurs sont proches de la référence.
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

  /** Toggle « Taille réelle » (11.H) : bascule normalisation ↔ échelles brutes de tous les frères. */
  const toggleNormalized = useCallback(() => {
    const next = !normalized;
    setNormalized(next);
    for (const [id, mesh] of siblingsRef.current) {
      applyNormalization(mesh, normRef.current.get(id) ?? null, next);
      baseXRef.current.set(id, mesh.position.x);
    }
    // En mode « voir tous », ré-écarte avec le nouvel espacement (les largeurs ont changé).
    if (mode === 'all') void viewAll();
  }, [normalized, mode, viewAll]);

  // Démontage : retire et libère les frères chargés (le principal appartient au viewer).
  useEffect(() => {
    const map = siblingsRef.current;
    return () => {
      map.forEach((mesh) => {
        (mesh as unknown as { dispose?: () => void }).dispose?.();
        mesh.removeFromParent();
      });
      map.clear();
    };
  }, []);

  return { enabled, splats, mode, activeId, busy, normalized, toggleNormalized, switchTo, viewAll };
}

export type SplatCompareState = ReturnType<typeof useSplatCompare>;
