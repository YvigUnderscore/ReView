// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MessageKey } from '../../i18n';

/**
 * États d'un commentaire de review (D1).
 *
 * Un fil n'avait que deux états, ouvert ou résolu : « je m'en occupe », « je ne comprends
 * pas la note » et « on ne corrigera pas » se disaient dans le texte, donc nulle part de
 * lisible. Quatre états explicites, une couleur chacun, et un filtre du fil.
 */

export type CommentState = 'OPEN' | 'WIP' | 'QUESTION' | 'WONT_FIX' | 'RESOLVED';

export const COMMENT_STATES: readonly CommentState[] = ['OPEN', 'WIP', 'QUESTION', 'WONT_FIX', 'RESOLVED'];

export const STATE_LABEL_KEY: Record<CommentState, MessageKey> = {
  OPEN: 'comment.state.open',
  WIP: 'comment.state.wip',
  QUESTION: 'comment.state.question',
  WONT_FIX: 'comment.state.wontFix',
  RESOLVED: 'comment.state.resolved',
};

/**
 * Teinte de la carte. Les classes sont écrites en entier — Tailwind purge tout ce qu'il ne
 * lit pas littéralement dans le source, une classe composée à l'exécution disparaîtrait.
 */
export const STATE_CARD_CLASS: Record<CommentState, string> = {
  OPEN: 'border-border',
  WIP: 'border-info/60 bg-info/5',
  QUESTION: 'border-warning/60 bg-warning/5',
  WONT_FIX: 'border-muted-foreground/40 bg-muted/30',
  RESOLVED: 'border-success/50 bg-success/5',
};

export const STATE_DOT_CLASS: Record<CommentState, string> = {
  OPEN: 'bg-muted-foreground/50',
  WIP: 'bg-info',
  QUESTION: 'bg-warning',
  WONT_FIX: 'bg-muted-foreground/40',
  RESOLVED: 'bg-success',
};

/** Un état qui ferme le fil : la carte s'efface, elle n'a plus à retenir l'attention. */
export function isClosed(state: CommentState): boolean {
  return state === 'RESOLVED' || state === 'WONT_FIX';
}

/**
 * État effectif d'un commentaire. Les commentaires antérieurs à D1 ne portent que
 * `isResolved` : sans ce repli, ils s'afficheraient tous comme ouverts.
 */
export function stateOf(comment: { state?: string | null; isResolved: boolean }): CommentState {
  const value = comment.state;
  if (value && (COMMENT_STATES as readonly string[]).includes(value)) return value as CommentState;
  return comment.isResolved ? 'RESOLVED' : 'OPEN';
}

/** Filtre du fil : `null` = tout montrer. */
export function matchesFilter(
  comment: { state?: string | null; isResolved: boolean },
  filter: CommentState | null,
): boolean {
  return filter === null || stateOf(comment) === filter;
}

/**
 * Le geste du bouton principal : résoudre, ou rouvrir si c'est déjà fait. Les autres états
 * passent par le clic droit — un bouton par état ferait cinq boutons sur chaque carte.
 */
export function toggleState(current: CommentState): CommentState {
  return current === 'RESOLVED' ? 'OPEN' : 'RESOLVED';
}
