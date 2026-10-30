// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Hint classes, isolated from the component so they can be checked without rendering — same
 * split as `button.variants.ts` and `card.variants.ts`.
 *
 * The rule this file encodes: **an explanatory note shrinks, an error or confirmation
 * message never does**. A hint nobody reads has failed its job; an error nobody reads loses
 * the data. The `error` and `success` tones therefore stay at `text-sm` whatever is asked,
 * and `size` only applies to notes.
 */

/** `note`: the help line of a setting. `fine`: the panel footnote, one step lower. */
export type HintSize = 'note' | 'fine';

/** `muted` explains; `error` and `success` report on an action. */
export type HintTone = 'muted' | 'error' | 'success';

export function hintClasses(tone: HintTone = 'muted', size: HintSize = 'note'): string {
  if (tone === 'error') return 'text-sm text-destructive';
  if (tone === 'success') return 'text-sm text-success';
  return size === 'fine' ? 'text-2xs text-muted-foreground' : 'text-xs text-muted-foreground';
}
