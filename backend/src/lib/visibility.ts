// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { badRequest } from './errors';

/**
 * The pattern of a hiding rule, and the only way to evaluate it.
 *
 * Hiding works on the entity's **code** ("SH999_TMP"), and on its **name** when it has no code
 * (an asset has no code). Both are tested: a naming convention sometimes concerns one, sometimes
 * the other, and requiring the admin to guess which would only have produced rules that hide
 * nothing.
 *
 * Four forms, from the safest to the most expressive. `exact` is the default because it is what
 * the "hide this item" gesture does; `regex` exists for the studio that has a convention, and it is
 * the only one able to go wrong, hence validation at write time.
 */

export const MATCH_TYPES = ['exact', 'prefix', 'contains', 'regex'] as const;
export type MatchType = (typeof MATCH_TYPES)[number];

export const VISIBILITY_TYPES = ['all', 'episode', 'sequence', 'shot', 'asset'] as const;
export type VisibilityType = (typeof VISIBILITY_TYPES)[number];

export interface RulePattern {
  matchType: MatchType;
  pattern: string;
  ignoreCase: boolean;
}

/**
 * Maximum length of an accepted regular expression.
 *
 * JavaScript's expression engine backtracks, and a short expression is already enough to make it
 * explode (`(a+)+$`). The bound alone is not sufficient: it is the timed test below that really
 * protects. It simply rules out from the start what no studio naming justifies.
 */
const MAX_PATTERN = 200;

/**
 * Duration beyond which an expression is considered dangerous (ms).
 *
 * A rule is evaluated on every shot of a project (two thousand on a feature film) and replayed at
 * each import. An expression that takes ten milliseconds on a twenty-character string would take
 * minutes on the whole project.
 */
const BUDGET_MS = 25;

/** Test string: enough to trigger the backtracking of a pathological expression. */
const PROBE = `${'a'.repeat(40)}!${'A_'.repeat(20)}9`;

/**
 * Compiles the pattern of a rule, or refuses it.
 *
 * Refusing at write time is the only moment when the admin can correct it: later, the rule would
 * appear active while hiding nothing, and nobody would know why.
 */
export function compileRule(rule: RulePattern): (candidate: string) => boolean {
  const pattern = rule.pattern.trim();
  if (!pattern) throw badRequest('A visibility rule needs a pattern', 'PATTERN_EMPTY');
  if (pattern.length > MAX_PATTERN) throw badRequest('This pattern is too long', 'PATTERN_TOO_LONG');

  if (rule.matchType !== 'regex') {
    const needle = rule.ignoreCase ? pattern.toLocaleLowerCase() : pattern;
    return (candidate: string) => {
      const value = rule.ignoreCase ? candidate.toLocaleLowerCase() : candidate;
      if (rule.matchType === 'exact') return value === needle;
      if (rule.matchType === 'prefix') return value.startsWith(needle);
      return value.includes(needle);
    };
  }

  let regex: RegExp;
  try {
    regex = new RegExp(pattern, rule.ignoreCase ? 'iu' : 'u');
  } catch {
    throw badRequest('This regular expression is invalid', 'PATTERN_INVALID');
  }
  // Timed probe: an expression with catastrophic backtracking gives itself away on a short string.
  // Measuring it costs less than a blocked import once the rule is in place.
  const started = process.hrtime.bigint();
  regex.test(PROBE);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  if (elapsedMs > BUDGET_MS)
    throw badRequest('This regular expression is too slow to evaluate', 'PATTERN_TOO_SLOW');

  return (candidate: string) => {
    // `lastIndex` does not need resetting: the `g` flag is never set here.
    return regex.test(candidate);
  };
}

/** Does a rule apply to this type of entity? `all` covers all four. */
export function coversType(ruleType: string, entityType: VisibilityType): boolean {
  return ruleType === 'all' || ruleType === entityType;
}

/**
 * What a rule examines on an entity: its code, and its name when it differs.
 *
 * Returning both rather than the code alone avoids the question "should the rule be written on the
 * code or on the name?", which an admin has no reason to be able to answer.
 */
export function matchCandidates(entity: { code?: string | null; name?: string | null }): string[] {
  const out: string[] = [];
  if (entity.code) out.push(entity.code);
  if (entity.name && entity.name !== entity.code) out.push(entity.name);
  return out;
}

/** Does the entity fall under this rule? */
export function ruleMatches(
  rule: RulePattern & { entityType: string },
  entityType: VisibilityType,
  entity: { code?: string | null; name?: string | null },
): boolean {
  if (!coversType(rule.entityType, entityType)) return false;
  const test = compileRule(rule);
  return matchCandidates(entity).some(test);
}
