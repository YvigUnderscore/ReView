// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MessageKey } from '../../i18n';
import type { MatchType, VisibilityEntityType } from '../../lib/visibilityApi';

/**
 * Clés de traduction des règles de masquage, écrites en toutes lettres.
 *
 * Une clé composée à la volée (`` `visibility.type.${value}` ``) échappe au typage — et au
 * contrôle de cohérence des catalogues, qui ne saurait pas dire qu'il en manque une. Ces
 * tables coûtent quelques lignes et rendent l'oubli impossible à compiler.
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

/** L'exemple de motif de chaque forme, et ce qu'il masque. */
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
