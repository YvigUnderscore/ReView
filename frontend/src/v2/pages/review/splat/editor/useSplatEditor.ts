import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../../../../lib/apiClient';
import { isEditable } from '../../../../lib/shortcuts';
import { IDENTITY_SPLAT_TRANSFORM, type SplatTransform } from '../../reviewTypes';
import type { RenderMode } from '../scene/renderModes';
import type { SplatViewer } from '../useSplat';
import { useTransformGizmo, type GizmoMode } from './gizmos/useTransformGizmo';
import { hideSplats, rehideSplats, restoreSplats } from './operations/deleteSplats';
import { useEditHistory } from './operations/history';
import { useSelection } from './selection/useSelection';
import { useVolumes } from './volumes/useVolumes';

/** Outil actif de l'éditeur : gizmo de transformation ou sélection (rectangle/lasso). */
export type EditorTool = GizmoMode | 'select-rect' | 'select-lasso';

const GIZMO_TOOLS: readonly EditorTool[] = ['translate', 'rotate', 'scale'];

/** Raccourcis clavier de l'éditeur (sans modificateur, hors champs de saisie). */
const TOOL_KEYS: Record<string, EditorTool> = {
  t: 'translate',
  r: 'rotate',
  s: 'scale',
  b: 'select-rect', // B = box select (convention DCC)
  l: 'select-lasso',
};

/**
 * État et actions de l'éditeur de splat (10.G), sur le modèle de `useModel3D` : outil actif
 * (gizmo/sélection), mode de visualisation, transformation TRS + persistance (PATCH
 * `/api/media/:id/transform`, toasts), sélection par splat et raccourcis clavier. La logique
 * Three vit dans `gizmos/`, `selection/` et `scene/` ; les composants ne font que rendre.
 */
export function useSplatEditor(
  splat: SplatViewer,
  mediaId: number,
  saved: SplatTransform | null,
  onSaved: (t: SplatTransform | null) => void,
  enabled: boolean,
) {
  const { applyTransform, setRenderMode: applyRenderMode, ready } = splat;
  const [tool, setTool] = useState<EditorTool>('translate');
  const [renderMode, setRenderMode] = useState<RenderMode>('splats');
  const [transform, setTransform] = useState<SplatTransform>(saved ?? IDENTITY_SPLAT_TRANSFORM);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const selection = useSelection(splat);
  const history = useEditHistory();
  const volumes = useVolumes(splat, history.push);
  // Masque de suppression cumulé (indices masqués) — persisté au chantier H5.
  const deletedRef = useRef<Set<number>>(new Set());
  const [deletedCount, setDeletedCount] = useState(0);

  const isGizmoTool = GIZMO_TOOLS.includes(tool);

  const onGizmoChange = useCallback((t: SplatTransform) => {
    setTransform(t);
    setDirty(true);
  }, []);
  // Un volume sélectionné capte le gizmo : sa TRS vit dans l'objet Three (sérialisée en H5),
  // elle ne touche pas la transformation du splat.
  const volumeGizmoChange = useCallback(() => undefined, []);

  useTransformGizmo(splat, {
    enabled: enabled && isGizmoTool,
    mode: isGizmoTool ? (tool as GizmoMode) : 'translate',
    target: volumes.activeSdf,
    onChange: volumes.activeSdf ? volumeGizmoChange : onGizmoChange,
  });

  // Applique la transformation enregistrée au chargement ; le gizmo suit ensuite le mesh.
  useEffect(() => {
    if (enabled && ready) applyTransform(saved);
  }, [enabled, ready, applyTransform, saved]);

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
    selection.clear();
    history.push({
      label: 'Suppression de splats',
      undo: () => {
        restoreSplats(handle, hidden);
        for (const i of hidden.indices) deleted.delete(i);
        setDeletedCount(deleted.size);
      },
      redo: () => {
        rehideSplats(handle, hidden);
        for (const i of hidden.indices) deleted.add(i);
        setDeletedCount(deleted.size);
      },
    });
  }, [splat, selection, history]);

  // Raccourcis : outils (T/R/S/B/L sans modificateur), Suppr (suppression sélection),
  // Ctrl+Z / Ctrl+Maj+Z / Ctrl+Y (historique). Inactifs dans les champs et dialogs.
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
      const next = TOOL_KEYS[key];
      if (next) {
        e.preventDefault();
        setTool(next);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [enabled, history, deleteSelection]);

  const save = useCallback(async () => {
    setBusy(true);
    try {
      await api.patch(`/api/media/${mediaId}/transform`, { transform });
      onSaved(transform);
      setDirty(false);
      toast.success('Transformation enregistrée');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur à l'enregistrement de la transformation");
    } finally {
      setBusy(false);
    }
  }, [mediaId, transform, onSaved]);

  const reset = useCallback(async () => {
    setBusy(true);
    try {
      await api.patch(`/api/media/${mediaId}/transform`, { transform: null });
      applyTransform(null);
      setTransform(IDENTITY_SPLAT_TRANSFORM);
      setDirty(false);
      onSaved(null);
      toast.success('Transformation réinitialisée');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erreur à la réinitialisation');
    } finally {
      setBusy(false);
    }
  }, [mediaId, applyTransform, onSaved]);

  return {
    tool,
    setTool,
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
