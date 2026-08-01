import { useCallback, useEffect, useMemo, useState } from 'react';
import type * as THREE from 'three';
import type { MediaResp } from '../reviewTypes';
import type { ViewerSceneHandle } from '../viewer/sceneHandle';
import { buildPrimTree, type PrimNode } from './usdScenegraph';
import {
  emptyOverride,
  isEmptyOverride,
  isolatePrim,
  mergeOverrides,
  normalizeOverride,
  setPrimEdit,
  type PrimEdit,
  type SceneOverride,
} from './sceneOverride';
import {
  applyPlan,
  indexPrimObjects,
  planOverride,
  renderedPrimPaths,
  type IndexedObject,
  type VariantSelection,
} from './sceneOverrideApply';

/**
 * Scenegraph USD et « ReView override » du viewer 3D (Phase 46, 46.C).
 *
 * Trois étages se composent, du plus stable au plus volatil :
 *  1. l'override **de base** du média, figé à la publication et rejoué pour tous ;
 *  2. la **proposition** portée par le commentaire sélectionné, le cas échéant ;
 *  3. l'**exploration locale** du spectateur, jamais enregistrée tant qu'elle n'est pas
 *     attachée à un commentaire ou (avant publication) sauvegardée comme override de base.
 *
 * Tout s'applique au chargement sans reconversion : changer de variante, masquer un prim ou
 * le déplacer se voit immédiatement, y compris sur un asset publié.
 */

export interface UsdSceneState {
  /** Arbre de prims, vide si le média n'est pas une scène USD analysée. */
  tree: PrimNode[];
  /** Chemins réellement présents dans le GLB (les autres sont grisés dans l'arbre). */
  renderedPaths: Set<string>;
  /** Override effectif appliqué à la scène (base + proposition + exploration locale). */
  override: SceneOverride;
  /** Options de variantes actives à la conversion. */
  variantDefaults: VariantSelection;
  selected: string | null;
  select: (path: string | null) => void;
  setPrim: (path: string, patch: PrimEdit | null) => void;
  isolate: (path: string) => void;
  setVariant: (prim: string, set: string, option: string) => void;
  /** Annule l'exploration locale et revient à l'override enregistré. */
  revert: () => void;
  /** Vrai si l'exploration locale diffère de ce qui est enregistré. */
  dirty: boolean;
  /** Delta local seul — c'est lui qu'on joint à un commentaire. */
  localDelta: SceneOverride;
  /** Override complet à enregistrer comme base (prépublish). */
  merged: SceneOverride;
}

/** Options de variantes actives à la conversion, indexées par prim. */
function defaultsFrom(data: MediaResp | null): VariantSelection {
  const sets = data?.modelSource?.usd?.variantSets ?? [];
  const defaults: VariantSelection = {};
  for (const set of sets) defaults[set.prim] = { ...(defaults[set.prim] ?? {}), [set.name]: set.selected };
  return defaults;
}

export function useUsdScene(
  data: MediaResp | null,
  getSceneHandle: () => ViewerSceneHandle | null,
  ready: boolean,
  /** Proposition du commentaire sélectionné, rejouée par-dessus l'override de base. */
  commentOverride: SceneOverride | null,
  /** Publie le delta local pour qu'il soit joint au prochain commentaire (46.D). */
  onLocalDelta?: (delta: SceneOverride | null) => void,
): UsdSceneState {
  const usd = data?.modelSource?.usd ?? null;
  const [local, setLocal] = useState<SceneOverride>(emptyOverride);
  const [selected, setSelected] = useState<string | null>(null);

  const tree = useMemo(() => buildPrimTree(usd?.prims ?? []), [usd]);
  const variantDefaults = useMemo(() => defaultsFrom(data), [data]);
  const base = useMemo(() => normalizeOverride(data?.usdOverride), [data?.usdOverride]);

  /** Ce qui est enregistré (base + proposition), sans l'exploration locale. */
  const stored = useMemo(() => mergeOverrides(base, commentOverride), [base, commentOverride]);
  const override = useMemo(() => mergeOverrides(stored, local), [stored, local]);

  /**
   * Indexation du modèle chargé : c'est là qu'on relève l'état d'origine de chaque objet, qui
   * sert de référence à l'application idempotente du delta. Dérivée du modèle plutôt que
   * stockée en état — elle ne fait que **lire** la scène Three, jamais la modifier.
   */
  const indexed = useMemo<IndexedObject<THREE.Object3D>[]>(() => {
    if (!ready) return [];
    const root = getSceneHandle()?.modelObject;
    if (!root) return [];
    return indexPrimObjects(
      root,
      (usd?.prims ?? []).map((p) => p.path),
    );
  }, [ready, getSceneHandle, usd]);

  // Application : recalculée depuis l'état d'origine, donc revenir en arrière rétablit
  // exactement la scène de départ.
  useEffect(() => {
    if (indexed.length === 0) return;
    applyPlan(planOverride(indexed, override, variantDefaults));
  }, [override, variantDefaults, indexed]);

  const renderedPaths = useMemo(() => new Set(renderedPrimPaths(indexed)), [indexed]);

  /**
   * Toute édition locale passe ici : elle met à jour la scène **et** publie le delta pour le
   * prochain commentaire. Fait dans le gestionnaire d'événement, pas dans un effet.
   */
  const editLocal = useCallback(
    (next: (current: SceneOverride) => SceneOverride) =>
      setLocal((current) => {
        const updated = next(current);
        onLocalDelta?.(isEmptyOverride(updated) ? null : updated);
        return updated;
      }),
    [onLocalDelta],
  );

  const setPrim = useCallback(
    (path: string, patch: PrimEdit | null) => editLocal((o) => setPrimEdit(o, path, patch)),
    [editLocal],
  );

  const isolate = useCallback(
    (path: string) => {
      const paths = (usd?.prims ?? []).map((p) => p.path);
      editLocal((o) => isolatePrim(o, path, paths));
    },
    [usd, editLocal],
  );

  const setVariant = useCallback(
    (prim: string, set: string, option: string) =>
      editLocal((o) => {
        const current = o.prims[prim]?.variants ?? {};
        return setPrimEdit(o, prim, { variants: { ...current, [set]: option } });
      }),
    [editLocal],
  );

  const revert = useCallback(() => editLocal(() => emptyOverride()), [editLocal]);

  return {
    tree,
    renderedPaths,
    override,
    variantDefaults,
    selected,
    select: setSelected,
    setPrim,
    isolate,
    setVariant,
    revert,
    dirty: !isEmptyOverride(local),
    localDelta: local,
    merged: override,
  };
}
