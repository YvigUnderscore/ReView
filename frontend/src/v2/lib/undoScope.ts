// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import { isEditable } from './shortcuts';

/**
 * Ctrl+Z / Ctrl+Maj+Z / Ctrl+Y : **un seul** gestionnaire pour toute l'application.
 *
 * Chaque écran qui tient un historique local s'y inscrit (`useUndoScope`) au lieu de poser son
 * propre `keydown`. C'était le défaut : trois gestionnaires écoutaient déjà les mêmes touches
 * sur un splat (le composer d'annotation, l'éditeur de splat, l'animation caméra), chacun
 * appelait `preventDefault()` sans dire aux autres qu'il avait pris la frappe, et une seule
 * pression défaisait **deux** choses dès que deux historiques avaient un cran à rendre. La
 * convention écrite « je ne capte que si j'ai vraiment un cran » ne suffisait pas : elle ne
 * départage rien quand les deux en ont un.
 *
 * Le départage est donc explicite, par PRIORITÉ (`UNDO_PRIORITY`) et non par ordre de montage :
 * la frappe va au périmètre le plus prioritaire qui a réellement un cran à défaire, et à lui
 * seul. Ordre de montage des effets = ordre des composants, c'est-à-dire un hasard de
 * composition : le geste que l'utilisateur a en main ne s'en déduit pas.
 *
 * Deux gardes conservées de l'existant : jamais dans un champ de saisie (le Ctrl+Z du navigateur
 * y fait mieux notre travail), jamais quand un dialog est ouvert. Et un événement déjà traité
 * (`defaultPrevented`) est laissé tel quel — c'est ainsi que l'atelier layout garde la main
 * (`camera/useCameraShortcuts` écoute en phase de capture et coupe la propagation).
 */

/** Ce qu'une frappe demande à l'historique. */
export type UndoAction = 'undo' | 'redo';

/**
 * Priorités des périmètres. Plus haut = servi d'abord.
 *
 * L'ordre suit ce que l'utilisateur a dans les mains : un commentaire en cours de rédaction
 * passe avant l'éditeur du média, parce qu'on ne peut pas annoter et éditer dans le même geste,
 * et que le tracé est ce qui vient d'être fait. L'éditeur ferme la marche : c'est le repli.
 */
export const UNDO_PRIORITY = {
  /** Annotation en préparation : formes 2D et références collées (review image/vidéo). */
  composer: 30,
  /** Traits de la brosse de surface 3D en préparation (splat). */
  brush3d: 20,
  /** Édition non destructive du média : masque, volumes, transformation. */
  editor: 10,
} as const;

/** Un historique candidat à la frappe. */
export interface UndoScope {
  priority: number;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
}

/** Ce que la frappe demande, ou `null` si elle ne parle pas d'historique. Fonction pure. */
export function undoIntent(
  e: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'key'>,
): UndoAction | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const key = e.key.toLowerCase();
  if (key === 'z') return e.shiftKey ? 'redo' : 'undo';
  // Ctrl+Y est le redo de Windows ; Ctrl+Maj+Y n'est le raccourci de personne.
  if (key === 'y' && !e.shiftKey) return 'redo';
  return null;
}

/** Le périmètre servi : le plus prioritaire qui a vraiment un cran à rendre. Fonction pure. */
export function pickScope(scopes: Iterable<UndoScope>, action: UndoAction): UndoScope | null {
  let best: UndoScope | null = null;
  for (const scope of scopes) {
    if (!(action === 'undo' ? scope.canUndo : scope.canRedo)) continue;
    if (best === null || scope.priority > best.priority) best = scope;
  }
  return best;
}

/** Périmètres inscrits. Des réfs, pour que `canUndo` puisse changer sans réinscription. */
const registered = new Set<{ current: UndoScope }>();
let listening = false;

/** Applique la frappe — exporté pour le test, qui n'a pas de DOM à écouter. */
export function dispatchUndoKey(e: KeyboardEvent): void {
  if (e.defaultPrevented) return;
  const action = undoIntent(e);
  if (action === null) return;
  if (isEditable(e.target) || document.querySelector('[role="dialog"]')) return;
  const scope = pickScope(
    [...registered].map((ref) => ref.current),
    action,
  );
  if (scope === null) return;
  e.preventDefault();
  if (action === 'undo') scope.undo();
  else scope.redo();
}

/**
 * Inscrit l'historique de cet écran. `enabled` dit si le geste est dans les mains du lecteur ;
 * `canUndo`/`canRedo` disent s'il reste un cran — un périmètre vide laisse passer la frappe au
 * suivant, exactement comme avant.
 */
export function useUndoScope(scope: UndoScope & { enabled: boolean }): void {
  const ref = useRef(scope);
  // Miroir remis à jour à chaque rendu, lu seulement depuis le gestionnaire clavier.
  useEffect(() => {
    ref.current = scope;
  });

  const enabled = scope.enabled;
  useEffect(() => {
    if (!enabled) return;
    registered.add(ref);
    if (!listening) {
      listening = true;
      document.addEventListener('keydown', dispatchUndoKey);
    }
    return () => {
      registered.delete(ref);
      if (registered.size === 0 && listening) {
        listening = false;
        document.removeEventListener('keydown', dispatchUndoKey);
      }
    };
  }, [enabled]);
}
