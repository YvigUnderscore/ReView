// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { badRequest } from './errors';

/**
 * Le motif d'une règle de masquage, et la seule façon de l'évaluer.
 *
 * Masquer se joue sur le **code** de l'entité (« SH999_TMP »), et sur son **nom** à défaut
 * de code — un asset n'a pas de code. Les deux sont testés : une convention de nommage
 * porte tantôt sur l'un, tantôt sur l'autre, et exiger de l'admin qu'il devine lequel
 * n'aurait servi qu'à produire des règles qui ne masquent rien.
 *
 * Quatre formes, de la plus sûre à la plus expressive. `exact` est le défaut parce que
 * c'est ce que fait le geste « masquer cet élément » ; `regex` existe pour le studio qui a
 * une convention, et il est le seul à pouvoir se tromper — d'où la validation à l'écriture.
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
 * Longueur maximale d'une expression régulière acceptée.
 *
 * Le moteur d'expressions de JavaScript revient en arrière, et une expression courte suffit
 * déjà à le faire exploser (`(a+)+$`). La borne ne suffit pas à elle seule : c'est le test
 * chronométré ci-dessous qui protège réellement. Elle écarte simplement d'emblée ce qu'aucun
 * nommage de studio ne justifie.
 */
const MAX_PATTERN = 200;

/**
 * Durée au-delà de laquelle une expression est tenue pour dangereuse (ms).
 *
 * Une règle est évaluée sur chaque plan d'un projet — deux mille sur un long-métrage — et
 * rejouée à chaque import. Une expression qui met dix millisecondes sur une chaîne de vingt
 * caractères en mettra des minutes sur le projet entier.
 */
const BUDGET_MS = 25;

/** Chaîne d'épreuve : de quoi déclencher le retour en arrière d'une expression pathologique. */
const PROBE = `${'a'.repeat(40)}!${'A_'.repeat(20)}9`;

/**
 * Compile le motif d'une règle, ou refuse.
 *
 * Refuser à l'écriture est le seul moment où l'admin peut corriger : plus tard, la règle
 * paraîtrait active sans rien masquer, et personne ne saurait pourquoi.
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
  // Épreuve chronométrée : une expression à retour en arrière catastrophique se trahit sur
  // une chaîne courte. La mesurer coûte moins qu'un import bloqué une fois la règle posée.
  const started = process.hrtime.bigint();
  regex.test(PROBE);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  if (elapsedMs > BUDGET_MS)
    throw badRequest('This regular expression is too slow to evaluate', 'PATTERN_TOO_SLOW');

  return (candidate: string) => {
    // `lastIndex` n'a pas à être remis à zéro : le drapeau `g` n'est jamais posé ici.
    return regex.test(candidate);
  };
}

/** Une règle s'applique-t-elle à ce type d'entité ? `all` couvre les quatre. */
export function coversType(ruleType: string, entityType: VisibilityType): boolean {
  return ruleType === 'all' || ruleType === entityType;
}

/**
 * Ce qu'une règle examine sur une entité : son code, et son nom quand il en diffère.
 *
 * Renvoyer les deux plutôt que le seul code évite la question « faut-il écrire la règle sur
 * le code ou sur le nom ? », à laquelle un admin n'a aucune raison de savoir répondre.
 */
export function matchCandidates(entity: { code?: string | null; name?: string | null }): string[] {
  const out: string[] = [];
  if (entity.code) out.push(entity.code);
  if (entity.name && entity.name !== entity.code) out.push(entity.name);
  return out;
}

/** L'entité tombe-t-elle sous cette règle ? */
export function ruleMatches(
  rule: RulePattern & { entityType: string },
  entityType: VisibilityType,
  entity: { code?: string | null; name?: string | null },
): boolean {
  if (!coversType(rule.entityType, entityType)) return false;
  const test = compileRule(rule);
  return matchCandidates(entity).some(test);
}
