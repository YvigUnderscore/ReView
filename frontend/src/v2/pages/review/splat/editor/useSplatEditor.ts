import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../../../../lib/apiClient';
import { isEditable } from '../../../../lib/shortcuts';
import { IDENTITY_SPLAT_TRANSFORM, type SplatTransform } from '../../reviewTypes';
import type { RenderMode } from '../scene/renderModes';
import type { SplatViewer } from '../useSplat';
import { useTransformGizmo, type GizmoMode } from './gizmos/useTransformGizmo';
import { useSelection } from './selection/useSelection';

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

  const isGizmoTool = GIZMO_TOOLS.includes(tool);

  const onGizmoChange = useCallback((t: SplatTransform) => {
    setTransform(t);
    setDirty(true);
  }, []);

  useTransformGizmo(splat, {
    enabled: enabled && isGizmoTool,
    mode: isGizmoTool ? (tool as GizmoMode) : 'translate',
    onChange: onGizmoChange,
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

  // Raccourcis outils (T/R/S/B/L) — inactifs dans les champs et dialogs, sans modificateur.
  useEffect(() => {
    if (!enabled) return;
    const down = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (isEditable(e.target) || document.querySelector('[role="dialog"]')) return;
      const next = TOOL_KEYS[e.key.toLowerCase()];
      if (next) {
        e.preventDefault();
        setTool(next);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [enabled]);

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
    save,
    reset,
  };
}

export type SplatEditorState = ReturnType<typeof useSplatEditor>;
