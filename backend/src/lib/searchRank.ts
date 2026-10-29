// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What must come up first.
 *
 * Search used to return ten lists, each in database order — most recent first. Typing "SH0120" therefore placed the shot SH0120 after three media whose
 * file name contains "sh0120", and the order changed with every publication. That is not a ranking, it is a chronology.
 *
 * The score answers a simple question: **how much is this result what the user typed?** Four degrees, from the sharpest to the vaguest — equality, the
 * start, the whole word, the fragment somewhere. The field then counts: finding "rain" in the code of a shot is stronger than finding it in the middle
 * of a thirty-line brief.
 *
 * Pure and dependency-free: the ranking is tested without a database, and two callers cannot produce two versions of it.
 */

/** Where the match was found — from the most identifying to the most verbose. */
export type MatchField = 'code' | 'name' | 'description' | 'body';

/**
 * Two scales, and their order matters.
 *
 * The **quality** of the match weighs heavily, the **field** breaks ties. This is the right reading sense: "what I typed, found as-is" takes precedence
 * over "where it was found". Conversely — field with a strong weight — a fragment lost in the middle of a code would have beaten a word found exactly
 * in a description, which yields top results that nobody recognises.
 */
const QUALITY = { exact: 400, prefix: 300, word: 200, contains: 100 } as const;

/** Tie-break: a code identifies, a body of text evokes. */
const FIELD_WEIGHT: Record<MatchField, number> = {
  code: 40,
  name: 30,
  description: 20,
  body: 10,
};

/**
 * Normalisation: lowercase and accents removed.
 *
 * "Poursuite" and "poursuite" designate the same thing, and an artist rarely types accents in a search field. Without this normalisation, "heros" did not
 * find "héros" — which gives the impression that the search does not work.
 */
export function normalise(value: string): string {
  return value.toLocaleLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Score of a match in a given field. `null` when the value does not match at all — the caller then knows it has nothing to rank.
 */
export function fieldScore(
  value: string | null | undefined,
  query: string,
  field: MatchField,
): number | null {
  if (!value) return null;
  const haystack = normalise(value);
  const needle = normalise(query).trim();
  if (!needle) return null;
  const at = haystack.indexOf(needle);
  if (at === -1) return null;

  const quality =
    haystack === needle
      ? QUALITY.exact
      : at === 0
        ? QUALITY.prefix
        : // Start of a word: "pluie" in "sous la pluie" is worth more than in "parapluie".
          /[\s._\-/]/.test(haystack[at - 1] ?? '')
          ? QUALITY.word
          : QUALITY.contains;
  return quality + FIELD_WEIGHT[field];
}

/** The best score among several fields — it is this that ranks the result. */
export function bestScore(
  query: string,
  fields: { value: string | null | undefined; field: MatchField }[],
): number {
  let best = 0;
  for (const { value, field } of fields) {
    const score = fieldScore(value, query, field);
    if (score !== null && score > best) best = score;
  }
  return best;
}

/**
 * Sorts a list by descending score, **preserving the original order on ties**.
 *
 * The original order is that of the database — most recent first. On equal score, it is the right tie-break: between two shots that match equally well,
 * the one that moved recently is the one being sought.
 */
export function rankBy<T>(items: T[], score: (item: T) => number): T[] {
  return items
    .map((item, index) => ({ item, index, score: score(item) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
}
