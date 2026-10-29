// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MessageKey } from '../../i18n';
import type { MatchType, VisibilityEntityType } from '../../lib/visibilityApi';

/**
 * Translation keys for the hiding rules, written out in full.
 *
 * A key built on the fly (`` `visibility.type.${value}` ``) escapes typing — and the
 * catalogue consistency check, which could not tell that one is missing. These
 * tables cost a few lines and make forgetting impossible to compile.
 */

export const TYPE_LABEL: Record<VisibilityEntityType, MessageKey> = {
  all: 'visibility.type.all',
  episode: 'visibility.type.episode',
  sequence: 'visibility.type.sequence',
  shot: 'visibility.type.shot',
  asset: 'visibility.type.asset',
};

export const MATCH_LABEL: Record<MatchType, MessageKey> = {
  exact: 'visibility.match.exact',
  prefix: 'visibility.match.prefix',
  contains: 'visibility.match.contains',
  regex: 'visibility.match.regex',
};

/** The example pattern for each form, and what it hides. */
export const MATCH_EXAMPLE: Record<MatchType, MessageKey> = {
  exact: 'visibility.help.exact.pattern',
  prefix: 'visibility.help.prefix.pattern',
  contains: 'visibility.help.contains.pattern',
  regex: 'visibility.help.regex.pattern',
};

export const MATCH_EFFECT: Record<MatchType, MessageKey> = {
  exact: 'visibility.help.exact.effect',
  prefix: 'visibility.help.prefix.effect',
  contains: 'visibility.help.contains.effect',
  regex: 'visibility.help.regex.effect',
};
