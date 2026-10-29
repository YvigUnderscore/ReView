// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReviewStatus } from '../types/api';
import { statusSwatch } from '../lib/contrast';

/**
 * Pure helpers for the review decision (Phase 31), tested in isolation.
 * The status colours are studio data (hex), not theme tokens.
 */

/**
 * Inline style of a status badge or button: the studio tint carries the background and border, and the text is brought up
 * to the readability threshold of the current theme (A2). Previously the raw colour also served as the text colour: a dark
 * status vanished on the midnight theme, and a pale one on the light theme.
 */
export function reviewStatusStyle(color: string, isDark: boolean, selected = false) {
  const swatch = statusSwatch(color, isDark);
  if (!swatch) return { color, borderColor: `${color}66`, backgroundColor: `${color}1f` };
  return {
    color: swatch.color,
    borderColor: swatch.borderColor,
    // Selection: same tint, a little denser, to remain distinguishable by keyboard.
    backgroundColor: selected
      ? swatch.backgroundColor.replace(/ \/ [\d.]+\)$/, ' / 0.28)')
      : swatch.backgroundColor,
  };
}

/** Status preselected in the dialog: the current decision, otherwise the studio default, otherwise null. */
export function pickPreselectedStatus(
  current: Pick<ReviewStatus, 'id'> | null,
  statuses: Pick<ReviewStatus, 'id' | 'isDefault'>[],
): number | null {
  return current?.id ?? statuses.find((s) => s.isDefault)?.id ?? null;
}
