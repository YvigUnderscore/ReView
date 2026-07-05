import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../../../../lib/apiClient';
import type { SplatTransform } from '../../reviewTypes';
import type { SplatViewer } from '../useSplat';
import { useSplatEditor } from './useSplatEditor';
import { useTransformGizmo } from './gizmos/useTransformGizmo';
import SplatEditorToolbar from './SplatEditorToolbar';

/**
 * Éditeur de splat (10.G) — monté avant publication pour un gestionnaire. Gère les gizmos de
 * transformation 3D (visibles dans la vue) et la persistance TRS (`metadata.splatTransform`).
 * Orchestrateur mince : l'état vit dans `useSplatEditor`, la logique Three dans `gizmos/`, l'UI
 * dans `SplatEditorToolbar`. S'étoffe aux chantiers suivants (sélection, volumes, historique).
 */
export default function SplatEditor({
  splat,
  mediaId,
  saved,
  onSaved,
}: {
  splat: SplatViewer;
  mediaId: number;
  saved: SplatTransform | null;
  onSaved: (t: SplatTransform | null) => void;
}) {
  const {
    gizmoMode,
    setGizmoMode,
    renderMode,
    setRenderMode,
    transform,
    dirty,
    onGizmoChange,
    markSaved,
    resetState,
  } = useSplatEditor(saved);
  const { applyTransform, setRenderMode: applyRenderMode, ready } = splat;
  const [busy, setBusy] = useState(false);

  useTransformGizmo(splat, { enabled: true, mode: gizmoMode, onChange: onGizmoChange });

  // Applique la transformation enregistrée au chargement ; le gizmo suit ensuite le mesh.
  useEffect(() => {
    if (ready) applyTransform(saved);
  }, [ready, applyTransform, saved]);

  // Applique le mode de visualisation courant ; rétablit « splats » en quittant l'édition.
  useEffect(() => {
    if (ready) applyRenderMode(renderMode);
  }, [ready, applyRenderMode, renderMode]);
  useEffect(() => () => applyRenderMode('splats'), [applyRenderMode]);

  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`/api/media/${mediaId}/transform`, { transform });
      onSaved(transform);
      markSaved();
      toast.success('Transformation enregistrée');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur à l'enregistrement de la transformation");
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    try {
      await api.patch(`/api/media/${mediaId}/transform`, { transform: null });
      applyTransform(null);
      resetState();
      onSaved(null);
      toast.success('Transformation réinitialisée');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erreur à la réinitialisation');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SplatEditorToolbar
      gizmoMode={gizmoMode}
      onGizmoMode={setGizmoMode}
      renderMode={renderMode}
      onRenderMode={setRenderMode}
      dirty={dirty}
      busy={busy}
      onSave={() => void save()}
      onReset={() => void reset()}
    />
  );
}
