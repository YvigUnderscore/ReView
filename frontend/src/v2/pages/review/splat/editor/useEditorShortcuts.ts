import { useEffect } from 'react';
import { isEditable } from '../../../../lib/shortcuts';
import type { SplatViewer } from '../useSplat';
import type { EditorTool } from './useSplatEditor';

/** Raccourcis clavier de l'éditeur (sans modificateur, hors champs de saisie). */
const TOOL_KEYS: Record<string, EditorTool> = {
  v: 'navigate', // V = retour au mode navigation (aucun outil actif)
  t: 'translate',
  r: 'rotate',
  s: 'scale',
  b: 'select-rect', // B = box select (convention DCC)
  l: 'select-lasso',
  p: 'brush', // P = pinceau de surface
};

/**
 * Raccourcis clavier de l'éditeur de splat (extrait de `useSplatEditor` pour tenir le budget) :
 * outils (V/T/R/S/B/L/P sans modificateur), F/H (cadrer sélection / vue d'origine), Suppr
 * (suppression sélection), Ctrl+Z / Ctrl+Maj+Z / Ctrl+Y (historique). Inactifs dans les champs,
 * les dialogs et pendant un vol (clic droit + ZQSD, 11.G — les touches pilotent la caméra).
 */
export function useEditorShortcuts(opts: {
  enabled: boolean;
  splat: SplatViewer;
  history: { undo: () => void; redo: () => void };
  deleteSelection: () => void;
  frameSelection: () => void;
  frameHome: () => void;
  setTool: (t: EditorTool) => void;
}): void {
  const { enabled, splat, history, deleteSelection, frameSelection, frameHome, setTool } = opts;
  useEffect(() => {
    if (!enabled) return;
    const down = (e: KeyboardEvent) => {
      if (isEditable(e.target) || document.querySelector('[role="dialog"]')) return;
      if (splat.isFlying()) return;
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
  }, [enabled, splat, history, deleteSelection, frameSelection, frameHome, setTool]);
}
