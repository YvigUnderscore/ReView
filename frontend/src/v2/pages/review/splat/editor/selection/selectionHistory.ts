// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { EditOp } from '../operations/history';

/**
 * Crans d'historique des **sélections de masque** (Phase 50, lot 12).
 *
 * Seules les suppressions, les volumes et les transformations étaient annulables : un lasso
 * mal tracé, un coup de pinceau de trop, un « tout désélectionner » malheureux effaçaient un
 * travail de plusieurs minutes que rien ne rendait — alors même que Ctrl+Z répondait juste à
 * côté, pour l'opération d'après. La sélection entre donc dans le **même** historique que les
 * éditions (`operations/history`), au même rang de préséance (`UNDO_PRIORITY.editor`) : une
 * seule pile, un seul ordre, et l'annulation d'une suppression rend aussi la sélection qui
 * l'avait produite.
 *
 * Le cœur est pur : ce fichier ne sait ni ce qu'est un splat, ni comment la sélection
 * s'applique — il compare deux ensembles et fabrique l'opération.
 */

/** Deux sélections portent-elles exactement les mêmes splats ? */
export function sameSelection(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const index of a) if (!b.has(index)) return false;
  return true;
}

/**
 * Cran d'historique d'un changement de sélection, ou `null` quand le geste n'a rien changé :
 * un clic dans le vide, un lasso qui reprend exactement les mêmes splats, un « désélectionner »
 * sur une sélection déjà vide ne doivent pas consommer un Ctrl+Z pour rien.
 */
export function selectionOp(
  label: string,
  before: ReadonlySet<number>,
  after: ReadonlySet<number>,
  apply: (selection: ReadonlySet<number>) => void,
): EditOp | null {
  if (sameSelection(before, after)) return null;
  return { label, undo: () => apply(before), redo: () => apply(after) };
}
