// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { intlLocale } from '../v2/i18n';

/**
 * Taille de fichier lisible, dans la langue du lecteur.
 *
 * Les deux formateurs déjà présents dans l'application écrivent « Mo » et « Go » en dur :
 * ils affichent du français à un lecteur japonais, et le séparateur décimal est celui de
 * l'auteur. `Intl.NumberFormat` connaît les deux — unité et séparateur — pour les quatorze
 * langues, sans table à tenir.
 *
 * Base 1024, celle qu'annoncent les systèmes de fichiers et la console MinIO : afficher des
 * gigaoctets décimaux à côté d'un explorateur qui compte en binaire sème le doute sur le
 * chiffre plutôt que sur l'unité.
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
