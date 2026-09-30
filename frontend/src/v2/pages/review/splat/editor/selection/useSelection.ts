// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SplatViewer } from '../../useSplat';
import type { EditOp } from '../operations/history';
import { createSelectionHighlight, type SelectionHighlight } from './highlight';
import { captureCenters, selectByShape } from './screenSelect';
import { selectionOp } from './selectionHistory';
import type { SelectCombine, SelectionShape } from './shapes2d';
import { selectByBrush } from './surfaceBrush';
import { useT } from '../../../../../i18n';

/**
 * Sélection par splat (10.G, perf/lisibilité revues en V2) : ensemble d'indices sélectionnés,
 * alimenté par les formes tracées à l'écran (rectangle/lasso, Maj = ajouter / Alt = retirer).
 * Les centres sont mis en cache en `Float32Array` au premier commit (plus de passe
 * `forEachSplat` par sélection) et la surbrillance est une **teinte par index** injectée dans
 * le rendu Spark (`RgbaArray`) — nette par-dessus les gaussiennes, restaurée à la désélection.
 * `isHidden` exclut les splats masqués (suppression non-destructive) sans invalider le cache.
 *
 * Chaque geste de sélection est un **cran d'historique** (`pushHistory`, Phase 50 lot 12) :
 * Ctrl+Z rend la sélection précédente comme il rend une suppression. L'ensemble courant est
 * tenu dans une réf en plus de l'état — c'est elle que lisent les gestes et les crans, pour
 * que deux coups de pinceau d'une même image partent bien du résultat du précédent.
 */
export function useSelection(
  splat: SplatViewer,
  isHidden: (index: number) => boolean,
  /** Historique de l'éditeur. Absent (lecture seule) : la sélection reste, sans cran. */
  pushHistory?: (op: EditOp) => void,
) {
  const t = useT();
  const { getSceneHandle } = splat;
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const selectedRef = useRef<ReadonlySet<number>>(selected);
  const centersRef = useRef<Float32Array | null>(null);
  const highlightRef = useRef<SelectionHighlight | null>(null);
  // Ensemble d'avant le coup de pinceau en cours : un trait stampe en continu (un appel par
  // déplacement), et cent crans pour un seul geste rendraient Ctrl+Z inutilisable. Le cran
  // n'est poussé qu'au lâcher (`endBrush`), avec cet ensemble-là pour point de départ.
  const strokeRef = useRef<ReadonlySet<number> | null>(null);

  // Applique la teinte à chaque changement de sélection (création paresseuse : l'import Spark
  // est déjà en cache — le viewer l'a chargé — mais reste hors du bundle initial).
  useEffect(() => {
    if (selected.size === 0 && !highlightRef.current) return;
    const handle = getSceneHandle();
    if (!handle) return;
    let cancelled = false;
    void (async () => {
      if (!highlightRef.current) {
        const { RgbaArray } = await import('@sparkjsdev/spark');
        if (cancelled || highlightRef.current) return;
        highlightRef.current = createSelectionHighlight(handle, RgbaArray);
      }
      if (!cancelled) highlightRef.current.apply(selected);
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, getSceneHandle]);

  // Nettoyage au démontage de l'éditeur (détache l'override et libère la texture).
  useEffect(
    () => () => {
      highlightRef.current?.dispose();
      highlightRef.current = null;
      centersRef.current = null;
    },
    [],
  );

  /** Remplace la sélection **sans** cran d'historique : undo/redo, et suppression (qui a le sien). */
  const restore = useCallback((next: ReadonlySet<number>) => {
    selectedRef.current = next;
    setSelected(next);
  }, []);

  /** Remplace la sélection et inscrit le cran — sauf si le geste n'a rien changé. */
  const record = useCallback(
    (next: ReadonlySet<number>) => {
      const before = selectedRef.current;
      restore(next);
      const op = selectionOp(t('splat.undoSelect'), before, next, restore);
      if (op) pushHistory?.(op);
    },
    [restore, pushHistory, t],
  );

  /** Centres des splats, capturés une fois — `null` tant que la scène n'est pas montée. */
  const centersOf = useCallback(
    (mesh: Parameters<typeof captureCenters>[0]) => (centersRef.current ??= captureCenters(mesh)),
    [],
  );

  /** Applique une forme tracée à l'écran (au lâcher du drag) à la sélection courante. */
  const commitShape = useCallback(
    (shape: SelectionShape, combine: SelectCombine, viewport: { width: number; height: number }) => {
      const handle = getSceneHandle();
      if (!handle) return;
      const centers = centersOf(handle.mesh);
      record(selectByShape(handle, centers, isHidden, viewport, shape, selectedRef.current, combine));
    },
    [getSceneHandle, isHidden, centersOf, record],
  );

  /** Coup de pinceau de surface (V3) : disque écran + bande de profondeur au point touché. */
  const commitBrush = useCallback(
    (
      point: { x: number; y: number },
      radiusPx: number,
      combine: SelectCombine,
      viewport: { width: number; height: number },
    ) => {
      const handle = getSceneHandle();
      if (!handle) return;
      const centers = centersOf(handle.mesh);
      const prev = selectedRef.current;
      const next = selectByBrush(handle, centers, isHidden, viewport, point, radiusPx, prev, combine);
      if (!next) return;
      strokeRef.current ??= prev;
      restore(next);
    },
    [getSceneHandle, isHidden, centersOf, restore],
  );

  /** Fin du coup de pinceau (lâcher, annulation du pointeur) : le trait entier fait un cran. */
  const endBrush = useCallback(() => {
    const before = strokeRef.current;
    strokeRef.current = null;
    if (!before) return;
    const op = selectionOp(t('splat.undoSelect'), before, selectedRef.current, restore);
    if (op) pushHistory?.(op);
  }, [restore, pushHistory, t]);

  /** Signale des indices (dé)masqués — la teinte resynchronise leur alpha au prochain apply. */
  const markDirty = useCallback((indices: Iterable<number>) => {
    highlightRef.current?.markDirty(indices);
  }, []);

  /** « Tout désélectionner » : un geste de l'utilisateur, donc un cran comme les autres. */
  const clear = useCallback(() => record(new Set()), [record]);

  return { selected, commitShape, commitBrush, endBrush, clear, restore, markDirty };
}

export type SelectionState = ReturnType<typeof useSelection>;
