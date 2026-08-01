import { useCallback, useEffect, useMemo, useState } from 'react';
import type * as THREE from 'three';
import type { MediaResp } from '../reviewTypes';
import type { ViewerSceneHandle } from '../viewer/sceneHandle';
import { buildPrimTree, type PrimNode } from './usdScenegraph';
import { createSelectionGlow } from './selectionGlow';
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
  makePrimResolver,
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

/** Frames d'attente avant d'abandonner l'indexation (GLB sans `usdPath`). */
const MAX_INDEX_FRAMES = 60;

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
  /** Prim auquel appartient un objet de la scène — sélection au clic dans le viewer. */
  resolvePrim: (object: THREE.Object3D) => string | null;
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
  // Clé **stable** : la requête TanStack renvoie un objet neuf à chaque invalidation. Indexer
  // sur son identité re-capturerait comme « état d'origine » des transformations déjà
  // modifiées par l'override, qui se cumuleraient alors à chaque rafraîchissement.
  const primPathsKey = useMemo(() => (usd?.prims ?? []).map((p) => p.path).join('|'), [usd]);
  const [indexed, setIndexed] = useState<IndexedObject<THREE.Object3D>[]>([]);

  /**
   * Indexation du modèle chargé — relevé de l'état d'origine servant de référence à
   * l'application idempotente du delta.
   *
   * `ready` doit signaler la **scène Three réellement construite** (`useModel3DThree.ready`), pas
   * « le média est affichable » : le viewer expose sa scène de façon impérative, et lire un
   * `modelObject` pas encore posé laissait l'index vide pour toujours — le scenegraph ne pilotait
   * alors plus rien, ni la vue, ni la sélection, ni le halo.
   */
  useEffect(() => {
    // Média sans scenegraph USD : rien à indexer, et surtout aucune attente à lancer.
    if (!ready || !primPathsKey) return;
    let frame = 0;
    let attempts = 0;
    const paths = primPathsKey.split('|');
    const tryIndex = () => {
      const root = getSceneHandle()?.modelObject;
      const next = root ? indexPrimObjects(root, paths) : [];
      if (next.length > 0) {
        setIndexed(next);
        return;
      }
      // Filet de sécurité borné : `ready` garantit désormais que le modèle est posé, mais un
      // GLB sans `usdPath` (converti avant la phase 46) n'aurait jamais d'index — on ne laisse
      // pas tourner une boucle d'animation pour rien.
      if ((attempts += 1) > MAX_INDEX_FRAMES) return;
      frame = requestAnimationFrame(tryIndex);
    };
    tryIndex();
    return () => cancelAnimationFrame(frame);
  }, [ready, getSceneHandle, primPathsKey]);

  // Application : recalculée depuis l'état d'origine, donc revenir en arrière rétablit
  // exactement la scène de départ.
  useEffect(() => {
    if (indexed.length === 0) return;
    applyPlan(planOverride(indexed, override, variantDefaults));
  }, [override, variantDefaults, indexed]);

  const renderedPaths = useMemo(() => new Set(renderedPrimPaths(indexed)), [indexed]);
  const resolvePrim = useMemo(() => makePrimResolver(indexed), [indexed]);

  /**
   * Halo de sélection : recalculé quand la sélection ou l'override change (l'objet a pu être
   * déplacé ou masqué). Les objets d'un prim masqué ne reçoivent pas de halo.
   */
  useEffect(() => {
    const handle = getSceneHandle();
    if (!handle) return;
    const glow = createSelectionGlow(handle.THREE, handle.scene);
    // Le halo se charge de descendre jusqu'aux meshes réellement dessinés.
    glow.show(selected ? indexed.filter((i) => i.primPath === selected).map((i) => i.object) : []);
    return () => glow.dispose();
  }, [selected, indexed, override, getSceneHandle]);

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
    resolvePrim,
    setPrim,
    isolate,
    setVariant,
    revert,
    dirty: !isEmptyOverride(local),
    localDelta: local,
    merged: override,
  };
}
