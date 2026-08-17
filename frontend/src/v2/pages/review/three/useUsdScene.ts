// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as THREE from 'three';
import type { MediaResp } from '../reviewTypes';
import type { ViewerSceneHandle } from '../viewer/sceneHandle';
import { buildRenderedPrimTree, type PrimNode } from './usdScenegraph';
import { createSelectionGlow } from './selectionGlow';
import {
  emptyOverride,
  isEmptyOverride,
  isHidden,
  isolatePrim,
  mergeOverrides,
  normalizeOverride,
  parseClonePath,
  setPrimEdit,
  type PrimEdit,
  type PrimTransform,
  type SceneOverride,
} from './sceneOverride';
import {
  applyPlan,
  indexPrimObjects,
  makePrimResolver,
  planOverride,
  renderedPrimPaths,
  variantActive,
  variantOptionRenderable,
  type IndexedObject,
  type VariantSelection,
} from './sceneOverrideApply';
import type { AlignAxis, AlignMode } from './alignPrims';
import { useSceneClones } from './useSceneClones';
import { usePrimAlign } from './usePrimAlign';
import { usePrimTransforms, type PrimTransformCommit } from './usePrimTransforms';

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
  /** Multi-sélection de prims (B1) — le dernier est le **primaire** (pivot des menus). */
  selected: string[];
  /** Dernier prim sélectionné, ou null — l'équivalent de l'ancienne mono-sélection. */
  primary: string | null;
  /** Sélectionne : remplace la sélection, ou bascule l'appartenance (`additive` = Ctrl+clic). */
  select: (path: string | null, opts?: { additive?: boolean }) => void;
  /** Remplace la sélection entière (Maj+clic plage dans l'arbre). */
  selectMany: (paths: string[]) => void;
  /** Prim auquel appartient un objet de la scène — sélection au clic dans le viewer.
   *  Renvoie null pour un prim **verrouillé** (exclu du picking). */
  resolvePrim: (object: THREE.Object3D) => string | null;
  /** Prims verrouillés : insélectionnables au clic dans le viewer (B2). */
  locked: ReadonlySet<string>;
  toggleLock: (path: string) => void;
  /** Objets affichés de **tous** les prims sélectionnés — cadrage `F`, pivot du gizmo. */
  selectedObjects: () => THREE.Object3D[];
  /** Un objet représentatif par prim sélectionné — chacun reçoit la pose du gizmo de groupe. */
  representatives: () => THREE.Object3D[];
  /** Objet représentatif du prim primaire — compat mono-sélection (arbitrage du gizmo). */
  selectedObject: THREE.Object3D | null;
  /**
   * Fin de drag du gizmo de groupe : la pose courante de chaque représentant devient le delta
   * d'override de son prim (ou de son clone) — un seul lot. Renvoie les deltas avant/après.
   */
  commitPrimTransforms: (objects: readonly THREE.Object3D[]) => PrimTransformCommit[];
  /** Écrit un delta sur un prim ou un clone (`/prim#id`) — chemin unique de l'undo du gizmo. */
  applyPrimTransform: (path: string, transform: PrimTransform | null) => void;
  /** Duplique un prim (ou un clone) en clone d'override, le sélectionne, renvoie son pseudo-chemin. */
  duplicatePrim: (path: string) => string | null;
  /** Supprime un clone désigné par son pseudo-chemin. */
  deleteClone: (pseudo: string) => void;
  /** Aligne la sélection sur un axe monde (min/centre/max des boîtes englobantes) — C2. */
  alignSelected: (axis: AlignAxis, mode: AlignMode) => void;
  /** Répartit les centres de la sélection à intervalles réguliers sur un axe — C2. */
  distributeSelected: (axis: AlignAxis) => void;
  setPrim: (path: string, patch: PrimEdit | null) => void;
  isolate: (path: string) => void;
  setVariant: (prim: string, set: string, option: string) => void;
  /**
   * Vrai si retenir cette option affichera de la géométrie, compte tenu des options déjà
   * retenues sur les autres jeux du même prim — le menu grise les combinaisons non cuites
   * au lieu de faire disparaître l'objet (46.U).
   */
  variantChoiceRenderable: (prim: string, set: string, option: string) => boolean;
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
  const [selected, setSelected] = useState<string[]>([]);
  const [locked, setLocked] = useState<ReadonlySet<string>>(new Set());
  const [indexed, setIndexed] = useState<IndexedObject<THREE.Object3D>[]>([]);

  /**
   * Changement de média (autre asset de la version) : l'exploration locale — isolement,
   * visibilités, sélection — appartient à la scène qu'on quittait et ne doit pas suivre (46.K).
   * Ajusté pendant le rendu (pattern `useChromeState`), pas dans un effet.
   */
  const mediaId = data?.media.id ?? null;
  const [lastMediaId, setLastMediaId] = useState(mediaId);
  if (lastMediaId !== mediaId) {
    setLastMediaId(mediaId);
    setLocal(emptyOverride());
    setSelected([]);
    setLocked(new Set());
    setIndexed([]);
  }
  // Le delta en attente de commentaire est lui aussi abandonné avec la scène qui le portait.
  useEffect(() => {
    onLocalDelta?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- déclenché par le média, pas par l'identité du callback
  }, [mediaId]);

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

  // Clones de mise en scène (C1) : réconciliation des copies dans `useSceneClones`.
  const cloneIndex = useSceneClones(override, indexed, variantDefaults);

  // Miroir de `local` lisible dans les gestionnaires d'événements sans passer par un updater.
  const localRef = useRef(local);
  localRef.current = local;

  /**
   * Toute édition locale passe ici : elle met à jour la scène **et** publie le delta pour le
   * prochain commentaire. Fait dans le gestionnaire d'événement, pas dans un effet.
   *
   * Le delta est calculé **hors** de l'updater : appeler `onLocalDelta` (un setState du
   * parent) depuis l'updater est un effet de bord que React peut rejouer pendant le rendu —
   * les deux états partaient alors dans des rendus séparés, et l'effet de reset de
   * `Model3DReview` voyait « pas de proposition + exploration sale » : le premier delta du
   * gizmo était annulé à l'instant où il venait d'être commité.
   */
  const editLocal = useCallback(
    (next: (current: SceneOverride) => SceneOverride) => {
      const updated = next(localRef.current);
      localRef.current = updated;
      setLocal(updated);
      onLocalDelta?.(isEmptyOverride(updated) ? null : updated);
    },
    [onLocalDelta],
  );

  /** Tous les chemins présents dans le GLB, options de variantes comprises. */
  const loadedPaths = useMemo(() => renderedPrimPaths(indexed), [indexed]);

  /**
   * L'arbre couvre la scène **réellement chargée** : prims de l'analyseur + prims implicites
   * pour la géométrie des variantes cuites (46.G), que l'analyseur ne compose pas. Sans eux,
   * cette géométrie était insélectionnable dans l'arbre et l'isolement retombait sur le parent.
   */
  const tree = useMemo(() => buildRenderedPrimTree(usd?.prims ?? [], loadedPaths), [usd, loadedPaths]);

  /**
   * Chemins réellement affichés compte tenu des variantes retenues : les rangées d'une option
   * inactive sont grisées, comme les prims que l'analyseur connaît mais que le GLB n'a pas.
   */
  const renderedPaths = useMemo(() => {
    const shown = new Set<string>();
    for (const entry of indexed)
      if (variantActive(entry, override, variantDefaults)) shown.add(entry.primPath);
    return shown;
  }, [indexed, override, variantDefaults]);

  /** Index complet : objets du GLB + copies des clones (sélection, gizmo, halo, cadrage). */
  const allIndexed = useMemo(() => [...indexed, ...cloneIndex], [indexed, cloneIndex]);

  // Verrouillage (B2) : un prim verrouillé ne répond plus au picking du viewer — l'arbre, lui,
  // reste le chemin pour le sélectionner ou le déverrouiller.
  const baseResolver = useMemo(() => makePrimResolver(allIndexed), [allIndexed]);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const resolvePrim = useCallback(
    (object: THREE.Object3D) => {
      const path = baseResolver(object);
      return path && lockedRef.current.has(path) ? null : path;
    },
    [baseResolver],
  );
  const toggleLock = useCallback((path: string) => {
    setLocked((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const primary = selected[selected.length - 1] ?? null;

  const select = useCallback((path: string | null, opts?: { additive?: boolean }) => {
    setSelected((prev) => {
      // Ctrl+clic dans le vide : la sélection en cours ne bouge pas (comme dans un DCC).
      if (path === null) return opts?.additive || prev.length === 0 ? prev : [];
      if (!opts?.additive) return [path];
      return prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path];
    });
  }, []);
  const selectMany = useCallback((paths: string[]) => setSelected(paths), []);

  /** Objets affichés d'un prim ou d'un clone (visibles, variante active). */
  const objectsOf = useCallback(
    (path: string): THREE.Object3D[] => {
      const src = parseClonePath(path)?.path ?? path;
      if (isHidden(override, src)) return [];
      return allIndexed
        .filter((entry) => entry.primPath === path && variantActive(entry, override, variantDefaults))
        .map((entry) => entry.object);
    },
    [allIndexed, override, variantDefaults],
  );

  /** Objets affichés de tous les prims sélectionnés — cadrage `F` (46.I), pivot du gizmo. */
  const selectedObjects = useCallback(
    (): THREE.Object3D[] => selected.flatMap((path) => objectsOf(path)),
    [selected, objectsOf],
  );

  /** Un représentant par prim sélectionné — chacun reçoit la pose du gizmo de groupe. */
  const representatives = useCallback(
    (): THREE.Object3D[] =>
      selected.map((path) => objectsOf(path)[0]).filter((o): o is THREE.Object3D => !!o),
    [selected, objectsOf],
  );

  const selectedObject = useMemo(
    () => (primary ? (objectsOf(primary)[0] ?? null) : null),
    [primary, objectsOf],
  );

  // Poses des prims et des clones (commit du gizmo, duplication, suppression) — voir
  // `usePrimTransforms`.
  const { writeTransform, applyPrimTransform, commitPrimTransforms, duplicatePrim, deleteClone } =
    usePrimTransforms({
      getSceneHandle,
      allIndexed,
      override,
      local,
      objectsOf,
      editLocal,
      setSelected,
    });

  // Alignement / répartition (C2) — voir `usePrimAlign`.
  const { alignSelected, distributeSelected } = usePrimAlign({
    getSceneHandle,
    selected,
    objectsOf,
    override,
    editLocal,
    writeTransform,
  });

  /**
   * Halo de sélection : recalculé quand la sélection ou l'override change (l'objet a pu être
   * déplacé ou masqué). Les objets d'un prim masqué ne reçoivent pas de halo.
   */
  useEffect(() => {
    const handle = getSceneHandle();
    if (!handle) return;
    const glow = createSelectionGlow(handle.THREE, handle.scene);
    // Le halo se charge de descendre jusqu'aux meshes réellement dessinés.
    const paths = new Set(selected);
    glow.show(allIndexed.filter((i) => paths.has(i.primPath)).map((i) => i.object));
    return () => glow.dispose();
  }, [selected, allIndexed, override, getSceneHandle]);

  const setPrim = useCallback(
    (path: string, patch: PrimEdit | null) => editLocal((o) => setPrimEdit(o, path, patch)),
    [editLocal],
  );

  const isolate = useCallback(
    (path: string) => {
      // L'isolement couvre **tout** ce qui est chargé, pas seulement les prims composés par
      // l'analyseur : sans les chemins propres au GLB (variantes cuites, niveaux insérés par
      // Blender), ces objets échappaient au masquage et l'isolement semblait viser le parent.
      const paths = [...new Set([...(usd?.prims ?? []).map((p) => p.path), ...loadedPaths])];
      editLocal((o) => isolatePrim(o, path, paths));
    },
    [usd, loadedPaths, editLocal],
  );

  const setVariant = useCallback(
    (prim: string, set: string, option: string) =>
      editLocal((o) => {
        const current = o.prims[prim]?.variants ?? {};
        return setPrimEdit(o, prim, { variants: { ...current, [set]: option } });
      }),
    [editLocal],
  );

  const variantChoiceRenderable = useCallback(
    (prim: string, set: string, option: string) =>
      variantOptionRenderable(indexed, override, variantDefaults, prim, set, option),
    [indexed, override, variantDefaults],
  );

  const revert = useCallback(() => editLocal(() => emptyOverride()), [editLocal]);

  return {
    tree,
    renderedPaths,
    override,
    variantDefaults,
    selected,
    primary,
    select,
    selectMany,
    resolvePrim,
    locked,
    toggleLock,
    selectedObjects,
    representatives,
    selectedObject,
    commitPrimTransforms,
    applyPrimTransform,
    duplicatePrim,
    deleteClone,
    alignSelected,
    distributeSelected,
    setPrim,
    isolate,
    setVariant,
    variantChoiceRenderable,
    revert,
    dirty: !isEmptyOverride(local),
    localDelta: local,
    merged: override,
  };
}
