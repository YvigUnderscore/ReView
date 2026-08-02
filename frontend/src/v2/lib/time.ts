// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { intlLocale } from '../i18n';

/**
 * Temps relatif court, dans la langue courante.
 *
 * `Intl.RelativeTimeFormat` s'en charge : il connaît les formes de chaque langue
 * (« il y a 3 j », « 3 days ago », « 3 日前 ») là où une table de suffixes maison
 * n'aurait couvert que le français. Au-delà d'une semaine, la date absolue se lit
 * mieux qu'un compte de jours.
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
