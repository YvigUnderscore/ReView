// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Collapsing of oversized comments (D6).
 *
 * A thread can be read; a wall of text cannot. A comment that does not fit its surface therefore
 * opens collapsed and expands on click, and a thread of a hundred replies renders only the
 * latest ones, the earlier ones waiting for an explicit gesture.
 *
 * "Does not fit" is MEASURED, never estimated. A character ceiling gave the same answer to an
 * anchored card 15rem wide and to the much wider comment thread: the "expand" button appeared
 * from 67 characters, whereas more than 120 were needed to exceed three lines, and the click
 * revealed nothing. The real overflow of the collapsed element, by contrast, holds for every
 * width and every font size at once.
 */

/** Replies rendered straight away in a thread; the earliest ones wait for a click. */
export const VISIBLE_REPLIES = 10;

/** Plain text of sanitized content: this is what is counted, not the markup. */
const plainText = (html: string): string => html.replace(/<[^>]*>/g, '');

/** Readable length of a content: the measure announced by the collapse indicator. */
export const plainLength = (html: string): number => plainText(html).length;

/**
 * Measurement tolerance, in pixels. A rounded border or a half-pixel of line height hides no
 * text: below this, the collapse masks nothing and the indicator would have nothing to announce.
 */
export const CLIP_SLACK = 1;

/**
 * Does the collapsed element hide any text? `scrollHeight` holds the height of the whole content,
 * `clientHeight` the height left visible: their gap is exactly what the collapse hides. Nothing to
 * guess, therefore, neither about the surface width nor about the font.
 */
export const isClipped = (box: { scrollHeight: number; clientHeight: number } | null): boolean =>
  !!box && box.scrollHeight - box.clientHeight > CLIP_SLACK;

/** Long thread: the replies to render immediately, and those the click will reveal. */
export function splitReplies<T>(replies: readonly T[]): { hidden: T[]; shown: T[] } {
  if (replies.length <= VISIBLE_REPLIES) return { hidden: [], shown: [...replies] };
  return {
    hidden: replies.slice(0, replies.length - VISIBLE_REPLIES),
    shown: replies.slice(replies.length - VISIBLE_REPLIES),
  };
}
