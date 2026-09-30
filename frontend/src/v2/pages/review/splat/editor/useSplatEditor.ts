// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IDENTITY_SPLAT_TRANSFORM,
  type SplatEdits,
  type SplatEditsPatch,
  type SplatTransform,
} from '../../reviewTypes';
import { frameCameraToMesh } from '../scene/frameCamera';
import type { RenderMode } from '../scene/renderModes';
import type { SplatViewer } from '../useSplat';
import { frameCameraToSphere } from '../../viewer/frameCamera';
import type { GizmoTargetKind } from '../../viewer/gizmos/gizmoSettings';
import { readMeshTransform } from '../../viewer/gizmos/meshTransform';
import { useGizmoSettings } from '../../viewer/gizmos/useGizmoSettings';
import { useTransformGizmo, type GizmoMode } from '../../viewer/gizmos/useTransformGizmo';
import { hideSplats, rehideSplats, restoreSplats } from './operations/deleteSplats';
import { useEditHistory } from './operations/history';
import { encodeMask } from './persistence/mask';
import { encodeSubsetOps, type SubsetOp } from './persistence/subsetOps';
import { useSplatPersistence } from './persistence/useSplatPersistence';
import { useEditorSuspend } from './useEditorSuspend';
import type { SplatEditDraft } from '../splatEditPart';
import { meshBounds, selectionBounds } from './selection/bounds';
import { useSelection } from './selection/useSelection';
import { useSubsetTransform } from './selection/useSubsetTransform';
import { useEditorShortcuts } from './useEditorShortcuts';
import { useVolumes } from './volumes/useVolumes';
import { useCropReflect } from './volumes/useCropReflect';
import { useT } from '../../../../i18n';

/** Outil actif de l'éditeur : navigation (défaut, aucun outil), gizmo ou sélection. */
export type EditorTool = 'navigate' | GizmoMode | 'select-rect' | 'select-lasso' | 'brush';

const GIZMO_TOOLS: readonly EditorTool[] = ['translate', 'rotate', 'scale'];

/**
 * État et actions de l'éditeur de splat (10.G), sur le modèle de `useModel3D` : outil actif
 * (gizmo/sélection), mode de visualisation, transformation TRS + volumes + masque de
 * suppression, persistance non-destructive (PATCH `/api/media/:id/splat-edits` + masque
 * binaire, toasts), sélection par splat et raccourcis clavier. La logique Three vit dans
 * `gizmos/`, `selection/`, `volumes/` et `scene/` ; les composants ne font que rendre.
 */
export function useSplatEditor(
  splat: SplatViewer,
  mediaId: number,
  saved: SplatEdits | null,
  savedMaskUrl: string | null,
  savedSubsetUrl: string | null,
  onSaved: (patch: SplatEditsPatch) => void,
  enabled: boolean,
  /**
   * Une proposition d'édition venue d'un commentaire est-elle en cours de lecture ? L'éditeur
   * rend alors la main au rejeu, et la reprend intacte à la sortie (`useEditorSuspend`).
   */
  suspended = false,
) {
  const t = useT();
  const { applyTransform, setBaseFlip: applyBaseFlip, setRenderMode: applyRenderMode, ready } = splat;
  // Mode navigation par défaut (11.G) : ouvrir l'éditeur n'active aucun gizmo ni sélection.
  const [tool, setTool] = useState<EditorTool>('navigate');
  const [brushRadius, setBrushRadius] = useState(40);
  const [renderMode, setRenderMode] = useState<RenderMode>('splats');
  const [transform, setTransform] = useState<SplatTransform>(saved?.transform ?? IDENTITY_SPLAT_TRANSFORM);
  // Flip d'orientation à l'import (11.E) : true (défaut) = convention Y-down redressée.
  const [baseFlip, setBaseFlipState] = useState(saved?.baseFlip ?? true);
  const [dirty, setDirty] = useState(false);
  const markDirty = useCallback(() => setDirty(true), []);
  // Masque de suppression cumulé (indices masqués), sérialisé en bitset à l'enregistrement.
  const deletedRef = useRef<Set<number>>(new Set());
  const isHidden = useCallback((index: number) => deletedRef.current.has(index), []);
  const history = useEditHistory();
  // La sélection entre dans le MÊME historique que les éditions (Phase 50, lot 12) : un lasso,
  // un coup de pinceau ou un « tout désélectionner » sont des crans au même titre que la
  // suppression qu'ils préparent, et Ctrl+Z les rend dans l'ordre où ils ont été faits.
  const selection = useSelection(splat, isHidden, history.push);
  const volumes = useVolumes(splat, history.push, markDirty, enabled ? (saved?.volumes ?? null) : null);
  const [deletedCount, setDeletedCount] = useState(0);
  // Journal des transformations de sous-ensembles (Phase 28) — cumulé, sérialisé à l'enregistrement.
  const subsetOpsRef = useRef<SubsetOp[]>([]);
  // Volumes binaires trouvés au chargement (masque du média, ops déjà enregistrées) : ce qui est
  // au-delà est le geste de CETTE session, et c'est lui seul qu'une proposition emporte (lot 14).
  const basesRef = useRef({ mask: 0, subset: 0 });

  const isGizmoTool = GIZMO_TOOLS.includes(tool);

  const onGizmoChange = useCallback((t: SplatTransform) => {
    setTransform(t);
    setDirty(true);
  }, []);
  // Un volume sélectionné capte le gizmo : sa TRS vit dans l'objet Three (sérialisée à
  // l'enregistrement) — on la reflète dans un état pour les champs numériques (V4) + dirty.
  const [volumeTrs, setVolumeTrs] = useState<SplatTransform | null>(null);
  const activeSdf = volumes.activeSdf;
  const volumeGizmoChange = useCallback((t: SplatTransform) => {
    // Box/ellipsoïde : la taille dérive directement de `scale` (aucune synchro de rayon, Phase 28).
    setVolumeTrs(t);
    setDirty(true);
  }, []);

  // Synchronise la TRS affichée quand la cible du gizmo change (sélection/désélection volume) —
  // ajustement d'état pendant le rendu (pattern React « derived state »), pas d'effet.
  const [prevSdf, setPrevSdf] = useState(activeSdf);
  if (prevSdf !== activeSdf) {
    setPrevSdf(activeSdf);
    setVolumeTrs(activeSdf ? readMeshTransform(activeSdf) : null);
  }

  // Réglages du gizmo par type de cible (11.G) : mémorisés séparément, persistés localStorage.
  const targetKind: GizmoTargetKind = activeSdf ? 'volume' : 'splat';
  const gizmo = useGizmoSettings(targetKind);

  // Undo/redo du gizmo (Phase 26) : à la fin d'un drag, pousse une opération annulable qui
  // rejoue la TRS avant/après sur la cible (splat entier ou volume SDF actif).
  const historyPush = history.push;
  const gizmoCommit = useCallback(
    (before: SplatTransform, after: SplatTransform) => {
      const sdf = activeSdf;
      if (sdf) {
        const apply = (t: SplatTransform) => {
          sdf.position.fromArray(t.position);
          sdf.quaternion.fromArray(t.quaternion);
          sdf.scale.fromArray(t.scale);
          setVolumeTrs(t);
          setDirty(true);
        };
        historyPush({
          label: t('splat.transformVolume'),
          undo: () => apply(before),
          redo: () => apply(after),
        });
      } else {
        const apply = (t: SplatTransform) => {
          applyTransform(t);
          setTransform(t);
          setDirty(true);
        };
        historyPush({
          label: t('splat.transformSplat'),
          undo: () => apply(before),
          redo: () => apply(after),
        });
      }
    },
    [activeSdf, applyTransform, historyPush, t],
  );

  // TRS de sous-ensemble (Phase 28) : sélection non vide + aucun volume ciblé → le gizmo agit sur
  // les seuls splats sélectionnés (au barycentre), pas sur le mesh entier.
  const hasSubset = enabled && isGizmoTool && selection.selected.size > 0 && !activeSdf;

  useTransformGizmo(splat, {
    enabled: enabled && isGizmoTool && !hasSubset,
    mode: isGizmoTool ? (tool as GizmoMode) : 'translate',
    target: volumes.activeSdf,
    settings: gizmo.settings,
    onChange: volumes.activeSdf ? volumeGizmoChange : onGizmoChange,
    onCommit: gizmoCommit,
  });

  useSubsetTransform(splat, {
    enabled: hasSubset,
    mode: isGizmoTool ? (tool as GizmoMode) : 'translate',
    selected: selection.selected,
    settings: gizmo.settings,
    pushHistory: history.push,
    onChange: markDirty,
    opsRef: subsetOpsRef,
  });

  /** Saisie des champs numériques (V4) : applique la TRS à la cible du gizmo (splat ou volume). */
  const commitFields = useCallback(
    (t: SplatTransform) => {
      if (activeSdf) {
        activeSdf.position.fromArray(t.position);
        activeSdf.quaternion.fromArray(t.quaternion);
        activeSdf.scale.fromArray(t.scale);
        setVolumeTrs(t);
      } else {
        applyTransform(t);
        setTransform(t);
      }
      setDirty(true);
    },
    [activeSdf, applyTransform],
  );

  const activeVolumeItem = volumes.volumes.find((v) => v.id === volumes.activeId) ?? null;
  /** Cible des champs numériques du HUD : volume actif sinon splat entier. */
  const fields = {
    label: activeVolumeItem
      ? `${activeVolumeItem.shape === 'box' ? t('review.box') : t('review.sphere')} ${volumes.volumes.indexOf(activeVolumeItem) + 1}`
      : 'Splat',
    /** Forme de la cible (11.G) : champs contextualisés (rayon sphère / demi-extents boîte). */
    shape: activeVolumeItem?.shape ?? null,
    value: volumeTrs && activeSdf ? volumeTrs : transform,
    commit: commitFields,
  };

  // Applique la transformation enregistrée au chargement ; le gizmo suit ensuite le mesh.
  const savedTransform = saved?.transform ?? null;
  useEffect(() => {
    if (enabled && ready) applyTransform(savedTransform);
  }, [enabled, ready, applyTransform, savedTransform]);

  // Applique le flip d'orientation courant (11.E) — persisté à l'enregistrement.
  useEffect(() => {
    if (enabled && ready) applyBaseFlip(baseFlip);
  }, [enabled, ready, applyBaseFlip, baseFlip]);

  /** Bouton « Retourner » : bascule le flip d'orientation à l'import (11.E). */
  const toggleBaseFlip = useCallback(() => {
    setBaseFlipState((f) => !f);
    setDirty(true);
  }, []);

  // Applique le mode de visualisation courant ; rétablit « splats » en quittant l'édition.
  useEffect(() => {
    if (enabled && ready) applyRenderMode(renderMode);
  }, [enabled, ready, applyRenderMode, renderMode]);
  useEffect(() => {
    if (enabled) return () => applyRenderMode('splats');
  }, [enabled, applyRenderMode]);

  // Mode points : la teinte de sélection (portée par le mesh, opacité 0 ici) est reflétée dans
  // l'overlay de points — à l'entrée du mode comme à chaque changement (no-op hors mode points).
  const selectedSet = selection.selected;
  useEffect(() => {
    if (enabled && ready && renderMode === 'points') splat.reflectSelection(selectedSet);
  }, [enabled, ready, renderMode, selectedSet, splat]);
  // Reflet des volumes de crop dans l'overlay de points (Phase 28) — recalcul débouncé.
  useCropReflect(splat, { enabled, renderMode, volumes, trsTick: volumeTrs });

  /** Supprime (masque) la sélection courante — opération annulable (undo/redo). */
  const deleteSelection = useCallback(() => {
    const handle = splat.getSceneHandle();
    if (!handle || selection.selected.size === 0) return;
    const hidden = hideSplats(handle, selection.selected);
    if (!hidden) return;
    const deleted = deletedRef.current;
    // La sélection qui a produit la suppression fait partie de la suppression : elle est vidée
    // SANS cran propre (`restore`), et le cran de suppression la rend. Un seul Ctrl+Z ramène
    // donc les splats **et** la sélection — deux crans pour un geste ne se comprendraient pas.
    const selectedBefore = selection.selected;
    for (const i of hidden.indices) deleted.add(i);
    setDeletedCount(deleted.size);
    setDirty(true);
    selection.restore(new Set());
    selection.markDirty(hidden.indices);
    splat.reflectHidden(hidden.indices, true); // reflet immédiat en mode points
    history.push({
      label: t('splat.undoDelete'),
      undo: () => {
        restoreSplats(handle, hidden);
        for (const i of hidden.indices) deleted.delete(i);
        setDeletedCount(deleted.size);
        selection.restore(selectedBefore);
        selection.markDirty(hidden.indices);
        splat.reflectHidden(hidden.indices, false);
      },
      redo: () => {
        rehideSplats(handle, hidden);
        for (const i of hidden.indices) deleted.add(i);
        setDeletedCount(deleted.size);
        selection.restore(new Set());
        selection.markDirty(hidden.indices);
        splat.reflectHidden(hidden.indices, true);
      },
    });
  }, [splat, selection, history, t]);

  /** F : cadre la sélection courante (sinon tout le splat) en gardant la direction de vue. */
  const frameSelection = useCallback(() => {
    const handle = splat.getSceneHandle();
    if (!handle) return;
    const bounds = selectionBounds(handle, selection.selected) ?? meshBounds(handle);
    if (bounds) frameCameraToSphere(handle.camera, handle.controls, bounds.center, bounds.radius);
  }, [splat, selection]);

  /** H : vue d'origine (recadrage global identique au cadrage initial). */
  const frameHome = useCallback(() => {
    const handle = splat.getSceneHandle();
    if (handle) frameCameraToMesh(handle.THREE, handle.mesh, handle.camera, handle.controls);
  }, [splat]);

  // Raccourcis clavier (extraits dans un hook dédié pour tenir le budget de taille).
  useEditorShortcuts({ enabled, splat, history, deleteSelection, frameSelection, frameHome });

  // Lecture d'une proposition de commentaire : l'édition locale se retire de la scène, et y
  // revient telle quelle à la sortie (lot 14). Sans cela, le rejeu et l'éditeur écriraient dans
  // le même nuage — c'est la raison pour laquelle le rejeu était coupé aux gestionnaires.
  useEditorSuspend({
    enabled,
    suspended,
    splat,
    runtimesRef: volumes.runtimesRef,
    transform,
    baseFlip,
  });

  // Persistance (chargement masque/ops + enregistrement) — hook dédié.
  const buildEdits = useCallback(
    (): SplatEdits => ({ transform, volumes: volumes.serialize(), baseFlip }),
    [transform, volumes, baseFlip],
  );
  const onClean = useCallback(() => setDirty(false), []);
  const persistence = useSplatPersistence({
    splat,
    mediaId,
    enabled,
    savedMaskUrl,
    savedSubsetUrl,
    deletedRef,
    subsetOpsRef,
    setDeletedCount,
    notifyHiddenChanged: selection.markDirty,
    buildEdits,
    basesRef,
    onSaved,
    onClean,
  });

  /**
   * Ce que l'édition en cours propose au prochain commentaire (lot 14) : le borné, plus les
   * deux binaires encodés à la demande.
   *
   * Encodés **à la demande**, et non dans un état : un masque pèse jusqu'à quelques centaines
   * de kilo-octets, et le re-sérialiser à chaque rendu de l'éditeur serait absurde.
   *
   * Deux traitements différents, pour une raison : le masque est idempotent (le rejeu masque ce
   * qui ne l'est pas déjà), il part donc ENTIER dès que l'auteur y a ajouté quelque chose ; les
   * ops de sous-ensemble ne le sont pas, seules celles qu'il a ajoutées voyagent — celles du
   * média sont déjà appliquées chez le lecteur.
   */
  const buildProposal = useCallback((): SplatEditDraft => {
    const deleted = deletedRef.current;
    const addedOps = subsetOpsRef.current.slice(basesRef.current.subset);
    return {
      edits: buildEdits(),
      mask: deleted.size > basesRef.current.mask ? { bytes: encodeMask(deleted), count: deleted.size } : null,
      subset: addedOps.length > 0 ? { bytes: encodeSubsetOps(addedOps), count: addedOps.length } : null,
    };
  }, [buildEdits]);

  /**
   * Reprise locale : l'édition qui vient de partir dans un commentaire quitte l'éditeur.
   *
   * C'est la mécanique du modèle 3D, à la lettre (`Model3DReview` : proposition envoyée ⇒
   * `scene.revert()`). Sans elle, la même proposition se rejoindrait d'elle-même au commentaire
   * suivant (46.T) — et téléverserait son masque une deuxième fois.
   */
  const revertEdits = useCallback(() => {
    history.undoAll(); // restaure les splats masqués et retire les volumes ajoutés dans la session
    // Retour à ce que le média porte — pas à l'identité : l'éditeur reprend là où il aurait
    // ouvert. Les volumes enregistrés, créés hors historique, sont restés en place.
    applyTransform(savedTransform);
    setTransform(saved?.transform ?? IDENTITY_SPLAT_TRANSFORM);
    setBaseFlipState(saved?.baseFlip ?? true);
    history.clear();
    setDirty(false);
  }, [applyTransform, history, saved, savedTransform]);

  return {
    tool,
    setTool,
    brushRadius,
    setBrushRadius,
    fields,
    gizmo,
    renderMode,
    setRenderMode,
    transform,
    baseFlip,
    toggleBaseFlip,
    dirty,
    // Sérialisation de l'édition en cours : lue par la persistance, et — binaires compris —
    // par la proposition jointe au commentaire (lot 14).
    buildEdits,
    buildProposal,
    revertEdits,
    busy: persistence.busy,
    selection,
    deleteSelection,
    deletedCount,
    volumes,
    history,
    save: persistence.save,
  };
}

export type SplatEditorState = ReturnType<typeof useSplatEditor>;
