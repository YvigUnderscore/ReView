// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { UNDO_PRIORITY, useUndoScope } from '../../lib/undoScope';

/**
 * Ctrl+Z / Ctrl+Maj+Z / Ctrl+Y sur l'annotation en cours — formes **et** références collées.
 *
 * Le gestionnaire clavier lui-même vit maintenant dans `lib/undoScope`, partagé avec l'éditeur
 * de splat et la brosse 3D. Ce module ne dit plus que ceci : le composer est le périmètre le
 * **plus prioritaire** (`UNDO_PRIORITY.composer`), et il ne réclame la frappe que s'il a
 * vraiment un cran à rendre — sinon elle retombe sur l'éditeur du média.
 *
 * Avant ce partage, chaque historique posait son propre `keydown` sur `document` : deux
 * historiques ayant un cran, une seule frappe en défaisait deux.
 */
export function useAnnotationShortcuts({
  enabled,
  canUndo,
  canRedo,
  undo,
  redo,
}: {
  enabled: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
}): void {
  useUndoScope({ enabled, priority: UNDO_PRIORITY.composer, canUndo, canRedo, undo, redo });
}
