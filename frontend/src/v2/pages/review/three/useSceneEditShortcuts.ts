// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import { isEditable } from '../../../lib/shortcuts';
import { UNDO_PRIORITY, useUndoScope } from '../../../lib/undoScope';
import { isHidden, parseClonePath, type SceneOverride } from './sceneOverride';
import type { UsdSceneState } from './useUsdScene';
import { useT } from '../../../i18n';

/**
 * Réagencement de la scène USD au clavier (lot 13) : **Suppr** masque la sélection, et
 * **Ctrl+Z / Ctrl+Maj+Z / Ctrl+Y** défont ce réagencement.
 *
 * Trois règles du dépôt commandent cette implémentation :
 *
 *  1. **Masquer, pas supprimer.** Le fichier USD d'origine n'est jamais réécrit : `Suppr` pose
 *     `visible: false` dans l'override ReView, une couche non destructive rejouée au chargement
 *     (46.B). D'où le nom du cran d'historique — « Masquer », et non « Supprimer ».
 *  2. **Un seul historique par frappe.** L'écran 3D en compte déjà plusieurs (annotation en
 *     cours, animation caméra) : on s'inscrit au registre de préséance du lot 9
 *     (`lib/undoScope`) au rang de REPLI (`UNDO_PRIORITY.editor`), sur l'historique que le
 *     viewer tient déjà pour ses gizmos (`useModel3DChrome`). Pas de quatrième pile : un
 *     masquage et un déplacement de prim se défont dans l'ordre où ils ont été faits.
 *  3. **Aucune promotion à l'écriture.** Le clic dans le viewer désigne le `component`
 *     englobant (lot 6), l'arbre et Alt+clic désignent la feuille : `Suppr` masque
 *     exactement les chemins que la sélection porte, sans les remonter ni les descendre. Ce
 *     qui est surligné est ce qui disparaît, et c'est ce chemin-là que l'override enregistre.
 */

/** Ce que `Suppr` va écrire : un prim à masquer, et la valeur à rendre en cas d'annulation. */
export interface HideStep {
  path: string;
  /** `visible` que l'exploration locale portait avant — `undefined` = aucune consigne. */
  before: boolean | undefined;
}

/**
 * Prims que `Suppr` doit masquer, pris dans la sélection telle quelle. Fonction pure.
 *
 * Deux exclusions. Un prim **déjà invisible** (à titre propre ou par un ancêtre masqué) ne
 * donne pas de cran : le masquer une seconde fois ne changerait rien à l'écran tout en
 * salissant le delta. Un **clone de mise en scène** (`/prim#id`) n'est pas masquable — c'est
 * une copie d'override, qui se retire par son menu contextuel ; le confondre avec son prim
 * source ferait disparaître l'original.
 */
export function planHide(
  selected: readonly string[],
  override: SceneOverride,
  local: SceneOverride,
): HideStep[] {
  const steps: HideStep[] = [];
  for (const path of selected) {
    if (parseClonePath(path) || isHidden(override, path)) continue;
    steps.push({ path, before: local.prims[path]?.visible });
  }
  return steps;
}

/** L'historique du viewer, vu d'ici : on y pousse un cran, et on le rejoue. */
interface SceneHistory {
  push: (op: { label: string; undo: () => void; redo: () => void }) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useSceneEditShortcuts(opts: {
  /** Scène USD du média — absente quand le modèle n'en est pas une. */
  scene?: UsdSceneState;
  /** Historique du viewer 3D : gizmos (46.N) et, désormais, masquages de prims. */
  history: SceneHistory;
  /**
   * `Suppr` nous appartient. Faux quand l'éditeur de courbes est ouvert : il supprime les clés
   * sélectionnées avec la même touche, et c'est lui qu'on a sous les yeux.
   */
  deleteEnabled: boolean;
  /** Vol en cours (clic droit maintenu) : les touches pilotent la caméra, pas la scène. */
  isFlying: () => boolean;
}): void {
  const { scene, history, deleteEnabled, isFlying } = opts;
  const t = useT();

  // L'historique du viewer prend la frappe au rang de repli : l'atelier caméra (phase de
  // capture) et le composer d'annotation passent devant, exactement comme sur un splat.
  useUndoScope({
    enabled: true,
    priority: UNDO_PRIORITY.editor,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    undo: history.undo,
    redo: history.redo,
  });

  // Miroir relu dans le gestionnaire clavier : la sélection et l'override changent à chaque
  // rendu, le gestionnaire ne doit pas être réinscrit pour autant.
  const ref = useRef({ scene, history, t });
  useEffect(() => {
    ref.current = { scene, history, t };
  });

  useEffect(() => {
    if (!deleteEnabled) return;
    const down = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (isEditable(e.target) || document.querySelector('[role="dialog"]')) return;
      if (isFlying()) return;
      const { scene: s, history: h, t: tr } = ref.current;
      if (!s) return;
      const steps = planHide(s.selected, s.override, s.localDelta);
      if (steps.length === 0) return;
      e.preventDefault();
      const { setPrim } = s;
      const apply = () => {
        for (const step of steps) setPrim(step.path, { visible: false });
      };
      apply();
      h.push({
        label: tr('common.hide'),
        undo: () => {
          for (const step of steps) setPrim(step.path, { visible: step.before });
        },
        redo: apply,
      });
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [deleteEnabled, isFlying]);
}
