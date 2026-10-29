// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Membership } from '../../types/api';

/**
 * Pure helpers for @user mentions (32.B): detecting the mention being typed, filtering members,
 * inserting the token, and highlighting at render time.
 */

/** Candidate offered by the autocomplete: handle inserted in the text, plus its displayed label. */
export interface MentionCandidate {
  id: number;
  handle: string;
  label: string;
}

/** Member handle: username, otherwise the local part of the email (matched on the backend). */
export function mentionHandle(user: { username?: string | null; email: string }): string {
  return user.username ?? user.email.split('@')[0];
}

export function toCandidates(members: Membership[]): MentionCandidate[] {
  return members.map((m) => ({
    id: m.user.id,
    handle: mentionHandle(m.user),
    label: m.user.name ?? m.user.email,
  }));
}

/**
 * Mention being typed: the last `@` before the caret, preceded by the start of a line or a
 * separator, with no space or other `@` between it and the caret.
 */
export function activeMentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && !/[\s([{.,;:!?'"«»]/.test(upto[at - 1])) return null;
  const query = upto.slice(at + 1);
  if (/[\s@]/.test(query)) return null;
  return { start: at, query };
}

export function filterCandidates(candidates: MentionCandidate[], query: string): MentionCandidate[] {
  const q = query.toLowerCase();
  return candidates
    .filter((c) => c.handle.toLowerCase().startsWith(q) || c.label.toLowerCase().includes(q))
    .slice(0, 6);
}

/** Replaces the current mention with `@handle ` and returns the new text and caret. */
export function insertMention(
  text: string,
  caret: number,
  start: number,
  handle: string,
): { text: string; caret: number } {
  const next = `${text.slice(0, start)}@${handle} ${text.slice(caret)}`;
  return { text: next, caret: start + handle.length + 2 };
}

/**
 * Highlights the `@xxx` tokens of sanitized HTML without touching the tags (the text is split on
 * tags; only the text segments are rewritten).
 */
export function highlightMentions(html: string): string {
  return html
    .split(/(<[^>]+>)/)
    .map((part) =>
      part.startsWith('<')
        ? part
        : part.replace(
            /(^|[\s([{.,;:!?'"«»])@([a-zA-Z0-9._-]+)/g,
            '$1<span class="text-primary font-medium">@$2</span>',
          ),
    )
    .join('');
}
