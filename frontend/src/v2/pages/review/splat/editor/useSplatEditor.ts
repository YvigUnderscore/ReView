import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../../../../lib/apiClient';
import { isEditable } from '../../../../lib/shortcuts';
import {
  IDENTITY_SPLAT_TRANSFORM,
  type SplatEdits,
  type SplatEditsPatch,
  type SplatTransform,
} from '../../reviewTypes';
import { frameCameraToMesh, frameCameraToSphere } from '../scene/frameCamera';
import type { RenderMode } from '../scene/renderModes';
import type { SplatViewer } from '../useSplat';
import { readMeshTransform } from './gizmos/meshTransform';
import { useTransformGizmo, type GizmoMode } from './gizmos/useTransformGizmo';
import { hideSplats, rehideSplats, restoreSplats } from './operations/deleteSplats';
import { useEditHistory } from './operations/history';
import { applyMaskIndices, fetchMaskIndices } from './persistence/applyEdits';
import { bytesToBase64, encodeMask } from './persistence/mask';
import { meshBounds, selectionBounds } from './selection/bounds';
import { useSelection } from './selection/useSelection';
import { useVolumes } from './volumes/useVolumes';

/** Outil actif de l'éditeur : gizmo de transformation ou sélection (rectangle/lasso/pinceau). */
export type EditorTool = GizmoMode | 'select-rect' | 'select-lasso' | 'brush';

const GIZMO_TOOLS: readonly EditorTool[] = ['translate', 'rotate', 'scale'];

/** Raccourcis clavier de l'éditeur (sans modificateur, hors champs de saisie). */
const TOOL_KEYS: Record<string, EditorTool> = {
  t: 'translate',
  r: 'rotate',
  s: 'scale',
  b: 'select-rect', // B = box select (convention DCC)
  l: 'select-lasso',
  p: 'brush', // P = pinceau de surface
};

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
  const { applyTransform, setRenderMode: applyRenderMode, ready } = splat;
  const [tool, setTool] = useState<EditorTool>('translate');
  const [brushRadius, setBrushRadius] = useState(40);
  const [renderMode, setRenderMode] = useState<RenderMode>('splats');
  const [transform, setTransform] = useState<SplatTransform>(saved?.transform ?? IDENTITY_SPLAT_TRANSFORM);
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
  const volumeGizmoChange = useCallback((t: SplatTransform) => {
    setVolumeTrs(t);
    setDirty(true);
  }, []);

  // Synchronise la TRS affichée quand la cible du gizmo change (sélection/désélection volume).
  const activeSdf = volumes.activeSdf;
  useEffect(() => {
    setVolumeTrs(activeSdf ? readMeshTransform(activeSdf) : null);
  }, [activeSdf]);

  useTransformGizmo(splat, {
    enabled: enabled && isGizmoTool,
    mode: isGizmoTool ? (tool as GizmoMode) : 'translate',
    target: volumes.activeSdf,
    onChange: volumes.activeSdf ? volumeGizmoChange : onGizmoChange,
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
    value: volumeTrs && activeSdf ? volumeTrs : transform,
    commit: commitFields,
  };

  // Applique la transformation enregistrée au chargement ; le gizmo suit ensuite le mesh.
  const savedTransform = saved?.transform ?? null;
  useEffect(() => {
    if (enabled && ready) applyTransform(savedTransform);
  }, [enabled, ready, applyTransform, savedTransform]);

  // Applique le mode de visualisation courant ; rétablit « splats » en quittant l'édition.
  useEffect(() => {
    if (enabled && ready) applyRenderMode(renderMode);
  }, [enabled, ready, applyRenderMode, renderMode]);
  useEffect(() => {
    if (enabled) return () => applyRenderMode('splats');
  }, [enabled, applyRenderMode]);

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
    history.push({
      label: 'Suppression de splats',
      undo: () => {
        restoreSplats(handle, hidden);
        for (const i of hidden.indices) deleted.delete(i);
        setDeletedCount(deleted.size);
        selection.markDirty(hidden.indices);
      },
      redo: () => {
        rehideSplats(handle, hidden);
        for (const i of hidden.indices) deleted.add(i);
        setDeletedCount(deleted.size);
        selection.markDirty(hidden.indices);
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

  // Raccourcis : outils (T/R/S/B/L sans modificateur), F/H (cadrer sélection / vue d'origine),
  // Suppr (suppression sélection), Ctrl+Z / Ctrl+Maj+Z / Ctrl+Y (historique). Inactifs dans
  // les champs et dialogs.
  useEffect(() => {
    if (!enabled) return;
    const down = (e: KeyboardEvent) => {
      if (isEditable(e.target) || document.querySelector('[role="dialog"]')) return;
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (key === 'z' && !e.shiftKey) {
          e.preventDefault();
          history.undo();
        } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
          e.preventDefault();
          history.redo();
        }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelection();
        return;
      }
      if (key === 'f') {
        e.preventDefault();
        frameSelection();
        return;
      }
      if (key === 'h') {
        e.preventDefault();
        frameHome();
        return;
      }
      const next = TOOL_KEYS[key];
      if (next) {
        e.preventDefault();
        setTool(next);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [enabled, history, deleteSelection, frameSelection, frameHome]);

  /** Enregistre toutes les éditions : transform + volumes (JSON) et masque de suppression. */
  const save = useCallback(async () => {
    setBusy(true);
    try {
      const edits: SplatEdits = { transform, volumes: volumes.serialize() };
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
  }, [mediaId, transform, volumes, savedMaskUrl, onSaved]);

  /** Réinitialise tout : annule l'historique (suppressions, volumes), transform identité, purge serveur. */
  const reset = useCallback(async () => {
    setBusy(true);
    try {
      history.undoAll(); // restaure les splats masqués et retire les volumes de la scène
      await api.patch(`/api/media/${mediaId}/splat-edits`, { edits: null });
      if (savedMaskUrl) await api.del(`/api/media/${mediaId}/splat-mask`);
      applyTransform(null);
      setTransform(IDENTITY_SPLAT_TRANSFORM);
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
    renderMode,
    setRenderMode,
    transform,
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
