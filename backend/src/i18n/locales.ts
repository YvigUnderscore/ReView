// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import registry from './locales.json';

/**
 * Registre des langues côté serveur — copie stricte de `frontend/src/v2/i18n/locales.json`
 * (l'écart est refusé par `scripts/check-translations.mjs`). Le backend en a besoin pour
 * les surfaces qu'il rend lui-même : emails, notifications, messages d'erreur.
 */
export type Locale =
  'en' | 'fr' | 'es' | 'de' | 'pt' | 'zh-Hans' | 'ko' | 'ja' | 'hi' | 'br' | 'eu' | 'co' | 'gsw-FR' | 'oc';

export type LocaleInfo = {
  code: Locale;
  native: string;
  english: string;
  dir: 'ltr' | 'rtl';
  regional: boolean;
  machineTranslated: boolean;
  intl: { plural: string[]; format: string[] };
};

/** Langue de référence : elle définit l'ensemble des clés et sert de repli universel. */
export const BASE_LOCALE: Locale = registry.base as Locale;

export const LOCALES = registry.locales as readonly LocaleInfo[];

export const LOCALE_CODES: readonly Locale[] = LOCALES.map((l) => l.code);

const BY_CODE = new Map<string, LocaleInfo>(LOCALES.map((l) => [l.code, l]));

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && BY_CODE.has(value);
}

/** Métadonnées d'une langue (repli sur la langue de base si le code est inconnu). */
export function localeInfo(code: Locale): LocaleInfo {
  return BY_CODE.get(code) ?? BY_CODE.get(BASE_LOCALE)!;
}

/**
 * Première étiquette candidate réellement connue d'`Intl`. Sans ce filtre,
 * `Intl.PluralRules('co')` retombe sur la locale par défaut du processus — donc sur une
 * langue qui n'a rien à voir, et les singuliers seraient rendus au pluriel.
 */
function firstSupported(
  api: { supportedLocalesOf(tags: string[]): string[] },
  candidates: readonly string[],
): string {
  for (const tag of candidates) {
    try {
      if (api.supportedLocalesOf([tag]).length > 0) return tag;
    } catch {
      /* étiquette mal formée : on passe à la candidate suivante */
    }
  }
  return BASE_LOCALE;
}

/** Étiquette à passer à `Intl.PluralRules` pour cette langue. */
export function pluralTag(code: Locale): string {
  return firstSupported(Intl.PluralRules, localeInfo(code).intl.plural);
}

/** Étiquette à passer aux formateurs de dates et de nombres. */
export function formatTag(code: Locale): string {
  return firstSupported(Intl.NumberFormat, localeInfo(code).intl.format);
}
