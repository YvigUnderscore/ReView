import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { SplatMesh } from '@sparkjsdev/spark';
import { api } from '../../../../../lib/apiClient';
import { qk } from '../../../../lib/query';
import type { Media, MediaSummary, VersionDetail } from '../../../../types/api';
import type { MediaResp } from '../../reviewTypes';
import type { SplatViewer } from '../useSplat';

/**
 * Comparaison des splats d'une même version (10.G-V8) : si la version porte plusieurs médias
 * SPLAT, charge les frères dans la même scène (même caméra) — **switch A/B** avec fondu,
 * **« voir tous »** côte à côte avec glissement. Réutilise la query de version du navigateur
 * (`qk.version`). Mono-média : inactif (no-op). Les frères sont chargés bruts (sans leurs
 * éditions non-destructives) — objectif comparatif.
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

export function useSplatCompare(splat: SplatViewer, current: Media) {
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
  const siblingsRef = useRef(new Map<number, SplatMesh>());
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
      siblingsRef.current.set(id, mesh);
      return mesh;
    },
    [getSceneHandle],
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
        toast.error(e instanceof Error ? e.message : 'Splat de comparaison inaccessible');
      } finally {
        setBusy(false);
      }
    },
    [current.id, ensureSibling, allMeshes, fade, slideX],
  );

  /** « Voir tous » : charge tous les frères et les écarte côte à côte. */
  const viewAll = useCallback(async () => {
    setBusy(true);
    try {
      const handle = getSceneHandle();
      if (!handle) return;
      for (const m of splats) if (m.id !== current.id) await ensureSibling(m.id);
      let spacing = 2;
      try {
        const box = handle.mesh.getBoundingBox(true);
        if (!box.isEmpty())
          spacing = (box.max.x - box.min.x) * 1.15 * Math.max(...handle.mesh.scale.toArray());
      } catch {
        // bbox indisponible : espacement par défaut
      }
      const offsets = sideBySideOffsets(splats.length, spacing);
      splats.forEach((m, i) => {
        const mesh = m.id === current.id ? handle.mesh : siblingsRef.current.get(m.id);
        if (!mesh) return;
        fade(mesh, 1);
        slideX(m.id, mesh, offsets[i]);
      });
      setMode('all');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Chargement des splats impossible');
    } finally {
      setBusy(false);
    }
  }, [getSceneHandle, splats, current.id, ensureSibling, fade, slideX]);

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

  return { enabled, splats, mode, activeId, busy, switchTo, viewAll };
}

export type SplatCompareState = ReturnType<typeof useSplatCompare>;
