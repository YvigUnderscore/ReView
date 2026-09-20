// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';
import { isEditable } from '../../../../lib/shortcuts';
import { UNDO_PRIORITY, useUndoScope } from '../../../../lib/undoScope';
import type { SplatViewer } from '../useSplat';

/**
 * Raccourcis clavier de l'éditeur de splat : F/H (cadrer la sélection / vue d'origine), Suppr
 * (suppression de la sélection), Ctrl+Z / Ctrl+Maj+Z / Ctrl+Y (historique). Inactifs dans les
 * champs, les dialogs et pendant un vol (clic droit + ZQSD — les touches pilotent la caméra).
 *
 * Le choix de l'outil ne passe plus par ici : depuis la refonte du chrome, c'est le rail qui
 * l'arme (`useChromeState`), et lui seul, pour que la lettre et le bouton ne divergent jamais.
 *
 * L'historique, lui, ne passe plus par ce gestionnaire : il s'inscrit au registre partagé
 * (`lib/undoScope`) au rang de REPLI (`UNDO_PRIORITY.editor`). C'est ce qui départage l'éditeur
 * de la brosse 3D et du composer d'annotation, qui écoutent les mêmes touches — avant, deux
 * historiques non vides se défaisaient ensemble sur une seule frappe. Corollaire assumé : le
 * vol ne bloque plus l'historique. La garde de vol protège les touches que le vol **utilise**
 * (ZQSD, et donc F/H/Suppr par voisinage) ; Ctrl+Z n'en est pas, et refuser d'annuler parce
 * qu'un clic droit est maintenu n'a jamais servi personne.
 */
export function useEditorShortcuts(opts: {
  enabled: boolean;
  splat: SplatViewer;
  history: { undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean };
  deleteSelection: () => void;
  frameSelection: () => void;
  frameHome: () => void;
}): void {
  const { enabled, splat, history, deleteSelection, frameSelection, frameHome } = opts;

  useUndoScope({
    enabled,
    priority: UNDO_PRIORITY.editor,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    undo: history.undo,
    redo: history.redo,
  });

  useEffect(() => {
    if (!enabled) return;
    const down = (e: KeyboardEvent) => {
      if (isEditable(e.target) || document.querySelector('[role="dialog"]')) return;
      if (splat.isFlying()) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelection();
        return;
      }
      const key = e.key.toLowerCase();
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
  }, [enabled, splat, deleteSelection, frameSelection, frameHome]);
}
