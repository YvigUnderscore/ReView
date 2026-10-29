// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { intlLocale } from '../i18n';

/**
 * Short relative time, in the current language.
 *
 * `Intl.RelativeTimeFormat` handles this: it knows each language's forms
 * ("il y a 3 j", "3 days ago", "3 日前") where a home-made table of suffixes
 * would only have covered French. Beyond a week, the absolute date reads
 * better than a count of days.
 */
export function timeAgo(iso: string): string {
  const locale = intlLocale();
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  const rel = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
  if (s < 60) return rel.format(0, 'second');
  const m = Math.floor(s / 60);
  if (m < 60) return rel.format(-m, 'minute');
  const h = Math.floor(m / 60);
  if (h < 24) return rel.format(-h, 'hour');
  const d = Math.floor(h / 24);
  if (d < 7) return rel.format(-d, 'day');
  return new Date(iso).toLocaleDateString(locale);
}
