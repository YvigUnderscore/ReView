import { useEffect } from 'react';
import type { ChromeState } from '../chrome/chromeState';
import type { ToolId } from '../chrome/tools';
import type { EditorTool } from './editor/useSplatEditor';
import type { SplatEditorState } from './editor/useSplatEditor';
import type { SplatPaintState } from './paint/useSplatPaint';

/** Outils du rail qui n'ont pas d'implémentation dans le viewer splat. */
export const SPLAT_HIDDEN_TOOLS: ToolId[] = ['region'];

/** Traduction rail → outil de l'éditeur splat. Tout le reste laisse l'éditeur au repos. */
const EDITOR_TOOL: Partial<Record<ToolId, EditorTool>> = {
  'sel-rect': 'select-rect',
  'sel-lasso': 'select-lasso',
  'sel-brush': 'brush',
  translate: 'translate',
  rotate: 'rotate',
  scale: 'scale',
};

/**
 * Fait suivre l'outil armé dans le rail aux hooks qui portent réellement le geste : l'éditeur
 * (sélection, gizmos), le painter 3D et la mise au point au clic. Le rail est la seule source
 * de vérité de l'outil courant — les hooks ne pilotent plus leur propre barre.
 */
export function useSplatChrome({
  state,
  editor,
  paint,
  focusPick,
  onToggleFocusPick,
  cameraRig,
}: {
  state: ChromeState;
  editor: SplatEditorState;
  paint: SplatPaintState;
  focusPick: boolean;
  onToggleFocusPick: () => void;
  /** Gizmo de la caméra-objet du mode layout (mise en scène). */
  cameraRig?: { mode: 'translate' | 'rotate'; setMode: (m: 'translate' | 'rotate') => void };
}) {
  const tool = state.tool;
  const { setTool } = editor;
  const { setActive } = paint;

  useEffect(() => {
    setTool(EDITOR_TOOL[tool] ?? 'navigate');
  }, [tool, setTool]);

  useEffect(() => {
    setActive(tool === 'paint');
  }, [tool, setActive]);

  // La mise au point au clic est un mode du rig caméra : on l'arme et on le désarme avec l'outil.
  useEffect(() => {
    if ((tool === 'focus') !== focusPick) onToggleFocusPick();
  }, [tool, focusPick, onToggleFocusPick]);

  useEffect(() => {
    if (!cameraRig) return;
    if (tool === 'cam-move') cameraRig.setMode('translate');
    else if (tool === 'cam-aim') cameraRig.setMode('rotate');
  }, [tool, cameraRig]);
}
