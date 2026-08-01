import { useEffect } from 'react';
import { isEditable } from '../../../../lib/shortcuts';
import type { SplatViewer } from '../useSplat';

/**
 * Raccourcis clavier de l'éditeur de splat : F/H (cadrer la sélection / vue d'origine), Suppr
 * (suppression de la sélection), Ctrl+Z / Ctrl+Maj+Z / Ctrl+Y (historique). Inactifs dans les
 * champs, les dialogs et pendant un vol (clic droit + ZQSD — les touches pilotent la caméra).
 *
 * Le choix de l'outil ne passe plus par ici : depuis la refonte du chrome, c'est le rail qui
 * l'arme (`useChromeState`), et lui seul, pour que la lettre et le bouton ne divergent jamais.
 */
export function useEditorShortcuts(opts: {
  enabled: boolean;
  splat: SplatViewer;
  history: { undo: () => void; redo: () => void };
  deleteSelection: () => void;
  frameSelection: () => void;
  frameHome: () => void;
}): void {
  const { enabled, splat, history, deleteSelection, frameSelection, frameHome } = opts;
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
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [enabled, splat, history, deleteSelection, frameSelection, frameHome]);
}
