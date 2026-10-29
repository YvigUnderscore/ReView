// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { intlLocale } from '../v2/i18n';

/**
 * Readable file size, in the reader's language.
 *
 * The two formatters already present in the application write "Mo" and "Go" hard-coded:
 * they display French to a Japanese reader, and the decimal separator is the author's.
 * `Intl.NumberFormat` knows both (unit and separator) for the fourteen
 * languages, without a table to maintain.
 *
 * Base 1024, the one announced by file systems and the MinIO console: showing decimal
 * gigabytes next to an explorer that counts in binary casts doubt on the
 * figure rather than on the unit.
 */
const UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;

export function formatBytes(bytes: number): string {
  const safe = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  const index = safe === 0 ? 0 : Math.min(UNITS.length - 1, Math.floor(Math.log(safe) / Math.log(1024)));
  return new Intl.NumberFormat(intlLocale(), {
    style: 'unit',
    unit: UNITS[index],
    unitDisplay: 'short',
    maximumFractionDigits: index === 0 ? 0 : 1,
  }).format(safe / 1024 ** index);
}
