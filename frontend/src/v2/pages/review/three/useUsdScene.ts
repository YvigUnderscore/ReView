import { useCallback, useEffect, useMemo, useState } from 'react';
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
  setPrimEdit,
  type PrimEdit,
  type PrimTransform,
  type SceneOverride,
} from './sceneOverride';
import {
  applyPlan,
  effectiveVariant,
  indexPrimObjects,
  makePrimResolver,
  planOverride,
  renderedPrimPaths,
  transformDeltaFrom,
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
  /** Objets affichés du prim sélectionné — cadrage `F` sur la sélection (46.I). */
  selectedObjects: () => THREE.Object3D[];
  /** Objet représentatif du prim sélectionné — cible du gizmo TRS par prim (46.N). */
  selectedObject: THREE.Object3D | null;
  /**
   * Fin de drag du gizmo : la pose courante de l'objet devient le delta d'override du prim.
   * Renvoie de quoi construire l'annulation (delta local avant/après), ou null hors index.
   */
  commitPrimTransform: (
    object: THREE.Object3D,
  ) => { path: string; before: PrimTransform | null; after: PrimTransform } | null;
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
    setSelected(null);
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
    for (const entry of indexed) {
      const active =
        !entry.variant ||
        effectiveVariant(override, variantDefaults, entry.variant.prim, entry.variant.set) ===
          entry.variant.option;
      if (active) shown.add(entry.primPath);
    }
    return shown;
  }, [indexed, override, variantDefaults]);

  const resolvePrim = useMemo(() => makePrimResolver(indexed), [indexed]);

  /** Objets affichés du prim sélectionné — cadrage `F` (46.I) et gizmo TRS (46.N). */
  const selectedObjects = useCallback((): THREE.Object3D[] => {
    if (!selected || isHidden(override, selected)) return [];
    return indexed
      .filter((entry) => entry.primPath === selected)
      .filter(
        (entry) =>
          !entry.variant ||
          effectiveVariant(override, variantDefaults, entry.variant.prim, entry.variant.set) ===
            entry.variant.option,
      )
      .map((entry) => entry.object);
  }, [selected, indexed, override, variantDefaults]);

  const selectedObject = useMemo(() => selectedObjects()[0] ?? null, [selectedObjects]);

  /**
   * Fin de drag du gizmo par prim (46.N) : la pose de l'objet manipulé, comparée à son état
   * d'origine, devient le delta d'override du prim — que `applyPlan` répercute alors sur tous
   * les objets du prim, pas seulement celui qui portait le gizmo.
   */
  const commitPrimTransform = useCallback(
    (object: THREE.Object3D) => {
      const entry = indexed.find((e) => e.object === object);
      if (!entry) return null;
      const before = local.prims[entry.primPath]?.transform ?? null;
      const after = transformDeltaFrom(entry.base, object);
      editLocal((o) => setPrimEdit(o, entry.primPath, { transform: after }));
      return { path: entry.primPath, before, after };
    },
    [indexed, local, editLocal],
  );

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

  const revert = useCallback(() => editLocal(() => emptyOverride()), [editLocal]);

  return {
    tree,
    renderedPaths,
    override,
    variantDefaults,
    selected,
    select: setSelected,
    resolvePrim,
    selectedObjects,
    selectedObject,
    commitPrimTransform,
    setPrim,
    isolate,
    setVariant,
    revert,
    dirty: !isEmptyOverride(local),
    localDelta: local,
    merged: override,
  };
}
