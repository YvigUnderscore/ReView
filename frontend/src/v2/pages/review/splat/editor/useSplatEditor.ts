import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../../../../lib/apiClient';
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
import { applyMaskIndices, fetchMaskIndices } from './persistence/applyEdits';
import { bytesToBase64, encodeMask } from './persistence/mask';
import { meshBounds, selectionBounds } from './selection/bounds';
import { useSelection } from './selection/useSelection';
import { useSubsetTransform } from './selection/useSubsetTransform';
import { useEditorShortcuts } from './useEditorShortcuts';
import { useVolumes } from './volumes/useVolumes';

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
  onSaved: (patch: SplatEditsPatch) => void,
  enabled: boolean,
) {
  const { applyTransform, setBaseFlip: applyBaseFlip, setRenderMode: applyRenderMode, ready } = splat;
  // Mode navigation par défaut (11.G) : ouvrir l'éditeur n'active aucun gizmo ni sélection.
  const [tool, setTool] = useState<EditorTool>('navigate');
  const [brushRadius, setBrushRadius] = useState(40);
  const [renderMode, setRenderMode] = useState<RenderMode>('splats');
  const [transform, setTransform] = useState<SplatTransform>(saved?.transform ?? IDENTITY_SPLAT_TRANSFORM);
  // Flip d'orientation à l'import (11.E) : true (défaut) = convention Y-down redressée.
  const [baseFlip, setBaseFlipState] = useState(saved?.baseFlip ?? true);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const markDirty = useCallback(() => setDirty(true), []);
  // Masque de suppression cumulé (indices masqués), sérialisé en bitset à l'enregistrement.
  const deletedRef = useRef<Set<number>>(new Set());
  const isHidden = useCallback((index: number) => deletedRef.current.has(index), []);
  const selection = useSelection(splat, isHidden);
  const history = useEditHistory();
  const volumes = useVolumes(splat, history.push, markDirty, enabled ? (saved?.volumes ?? null) : null);
  const [deletedCount, setDeletedCount] = useState(0);
  const maskInitRef = useRef(false);

  // Recharge le masque persisté (une fois) : masque appliqué + compteur initialisé, pour que
  // les suppressions suivantes s'y cumulent à l'enregistrement.
  const notifyHiddenChanged = selection.markDirty;
  useEffect(() => {
    if (!enabled || !ready || maskInitRef.current || !savedMaskUrl) return;
    maskInitRef.current = true;
    const handle = splat.getSceneHandle();
    if (!handle) return;
    fetchMaskIndices(savedMaskUrl)
      .then((indices) => {
        deletedRef.current = applyMaskIndices(handle, indices);
        setDeletedCount(deletedRef.current.size);
        notifyHiddenChanged(deletedRef.current);
      })
      .catch(() => toast.error('Masque de suppression illisible'));
  }, [enabled, ready, savedMaskUrl, splat, notifyHiddenChanged]);

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

  // Synchronise la TRS affichée quand la cible du gizmo change (sélection/désélection volume).
  useEffect(() => {
    setVolumeTrs(activeSdf ? readMeshTransform(activeSdf) : null);
  }, [activeSdf]);

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
        historyPush({ label: 'Transformer le volume', undo: () => apply(before), redo: () => apply(after) });
      } else {
        const apply = (t: SplatTransform) => {
          applyTransform(t);
          setTransform(t);
          setDirty(true);
        };
        historyPush({ label: 'Transformer le splat', undo: () => apply(before), redo: () => apply(after) });
      }
    },
    [activeSdf, applyTransform, historyPush],
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
      ? `${activeVolumeItem.shape === 'box' ? 'Boîte' : 'Sphère'} ${volumes.volumes.indexOf(activeVolumeItem) + 1}`
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

  /** Supprime (masque) la sélection courante — opération annulable (undo/redo). */
  const deleteSelection = useCallback(() => {
    const handle = splat.getSceneHandle();
    if (!handle || selection.selected.size === 0) return;
    const hidden = hideSplats(handle, selection.selected);
    if (!hidden) return;
    const deleted = deletedRef.current;
    for (const i of hidden.indices) deleted.add(i);
    setDeletedCount(deleted.size);
    setDirty(true);
    selection.clear();
    selection.markDirty(hidden.indices);
    splat.reflectHidden(hidden.indices, true); // reflet immédiat en mode points
    history.push({
      label: 'Suppression de splats',
      undo: () => {
        restoreSplats(handle, hidden);
        for (const i of hidden.indices) deleted.delete(i);
        setDeletedCount(deleted.size);
        selection.markDirty(hidden.indices);
        splat.reflectHidden(hidden.indices, false);
      },
      redo: () => {
        rehideSplats(handle, hidden);
        for (const i of hidden.indices) deleted.add(i);
        setDeletedCount(deleted.size);
        selection.markDirty(hidden.indices);
        splat.reflectHidden(hidden.indices, true);
      },
    });
  }, [splat, selection, history]);

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
  useEditorShortcuts({ enabled, splat, history, deleteSelection, frameSelection, frameHome, setTool });

  /** Enregistre toutes les éditions : transform + volumes (JSON) et masque de suppression. */
  const save = useCallback(async () => {
    setBusy(true);
    try {
      const edits: SplatEdits = { transform, volumes: volumes.serialize(), baseFlip };
      const { splatEdits } = await api.patch<{ splatEdits: SplatEdits | null }>(
        `/api/media/${mediaId}/splat-edits`,
        { edits },
      );
      const patch: SplatEditsPatch = { splatEdits };
      const deleted = deletedRef.current;
      if (deleted.size > 0) {
        const mask = await api.put<{ splatMaskUrl: string; splatMaskCount: number }>(
          `/api/media/${mediaId}/splat-mask`,
          { data: bytesToBase64(encodeMask(deleted)), count: deleted.size },
        );
        patch.splatMaskUrl = mask.splatMaskUrl;
        patch.splatMaskCount = mask.splatMaskCount;
      } else if (savedMaskUrl) {
        await api.del(`/api/media/${mediaId}/splat-mask`);
        patch.splatMaskUrl = null;
        patch.splatMaskCount = 0;
      }
      onSaved(patch);
      setDirty(false);
      toast.success('Éditions enregistrées');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur à l'enregistrement des éditions");
    } finally {
      setBusy(false);
    }
  }, [mediaId, transform, baseFlip, volumes, savedMaskUrl, onSaved]);

  /** Réinitialise tout : annule l'historique (suppressions, volumes), transform identité, purge serveur. */
  const reset = useCallback(async () => {
    setBusy(true);
    try {
      history.undoAll(); // restaure les splats masqués et retire les volumes de la scène
      await api.patch(`/api/media/${mediaId}/splat-edits`, { edits: null });
      if (savedMaskUrl) await api.del(`/api/media/${mediaId}/splat-mask`);
      applyTransform(null);
      setTransform(IDENTITY_SPLAT_TRANSFORM);
      setBaseFlipState(true); // retour à la convention d'import (l'effet ré-applique le flip)
      history.clear();
      setDirty(false);
      onSaved({ splatEdits: null, splatMaskUrl: null, splatMaskCount: 0 });
      toast.success('Éditions réinitialisées');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erreur à la réinitialisation');
    } finally {
      setBusy(false);
    }
  }, [mediaId, applyTransform, history, savedMaskUrl, onSaved]);

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
    busy,
    selection,
    deleteSelection,
    deletedCount,
    volumes,
    history,
    save,
    reset,
  };
}

export type SplatEditorState = ReturnType<typeof useSplatEditor>;
