import { useCallback, useState } from 'react';
import { IDENTITY_SPLAT_TRANSFORM, type SplatTransform } from '../../reviewTypes';
import type { RenderMode } from '../scene/renderModes';
import type { GizmoMode } from './gizmos/useTransformGizmo';

/**
 * État de l'éditeur de splat (10.G) : outil/mode de gizmo actif, mode de visualisation et
 * transformation TRS courante. Découplé du rendu (Three vit dans `gizmos/`/`scene/`) et de la
 * persistance (dans `SplatEditor`). Grandit aux chantiers suivants (sélection, volumes, historique).
 */
export function useSplatEditor(saved: SplatTransform | null) {
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>('translate');
  const [renderMode, setRenderMode] = useState<RenderMode>('splats');
  const [transform, setTransform] = useState<SplatTransform>(saved ?? IDENTITY_SPLAT_TRANSFORM);
  const [dirty, setDirty] = useState(false);

  // Remontée d'un changement de gizmo : mémorise la TRS et marque l'éditeur comme modifié.
  const onGizmoChange = useCallback((t: SplatTransform) => {
    setTransform(t);
    setDirty(true);
  }, []);

  const markSaved = useCallback(() => setDirty(false), []);
  const resetState = useCallback(() => {
    setTransform(IDENTITY_SPLAT_TRANSFORM);
    setDirty(false);
  }, []);

  return {
    gizmoMode,
    setGizmoMode,
    renderMode,
    setRenderMode,
    transform,
    dirty,
    onGizmoChange,
    markSaved,
    resetState,
  };
}
