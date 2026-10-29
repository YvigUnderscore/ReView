// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MessageKey } from '../../i18n';

/**
 * States of a review comment (D1).
 *
 * A thread had only two states, open or resolved: "I'm on it", "I don't understand the note"
 * and "this will not be fixed" were written in the text, hence nowhere readable. Four explicit
 * states, one colour each, and a thread filter.
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
 * Card tint. The classes are written out in full: Tailwind purges anything it does not read
 * literally in the source, and a class composed at runtime would disappear.
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

/** A state that closes the thread: the card fades, it no longer needs to hold attention. */
export function isClosed(state: CommentState): boolean {
  return state === 'RESOLVED' || state === 'WONT_FIX';
}

/**
 * Effective state of a comment. Comments predating D1 only carry `isResolved`: without this
 * fallback, they would all display as open.
 */
export function stateOf(comment: { state?: string | null; isResolved: boolean }): CommentState {
  const value = comment.state;
  if (value && (COMMENT_STATES as readonly string[]).includes(value)) return value as CommentState;
  return comment.isResolved ? 'RESOLVED' : 'OPEN';
}

/** Thread filter: `null` = show everything. */
export function matchesFilter(
  comment: { state?: string | null; isResolved: boolean },
  filter: CommentState | null,
): boolean {
  return filter === null || stateOf(comment) === filter;
}

/**
 * The main button's action: resolve, or reopen if already resolved. The other states go through
 * right-click, since one button per state would make five buttons on every card.
 */
export function toggleState(current: CommentState): CommentState {
  return current === 'RESOLVED' ? 'OPEN' : 'RESOLVED';
}
