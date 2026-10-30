// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import registry from './locales.json';

/**
 * Server-side language registry: a strict copy of `frontend/src/v2/i18n/locales.json`
 * (any divergence is rejected by `scripts/check-translations.mjs`). The backend needs it for
 * the surfaces it renders itself: emails, notifications, error messages.
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

/** Reference language: it defines the set of keys and serves as the universal fallback. */
export const BASE_LOCALE: Locale = registry.base as Locale;

export const LOCALES = registry.locales as readonly LocaleInfo[];

export const LOCALE_CODES: readonly Locale[] = LOCALES.map((l) => l.code);

const BY_CODE = new Map<string, LocaleInfo>(LOCALES.map((l) => [l.code, l]));

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && BY_CODE.has(value);
}

/** Metadata for a language (falls back to the base language if the code is unknown). */
export function localeInfo(code: Locale): LocaleInfo {
  return BY_CODE.get(code) ?? BY_CODE.get(BASE_LOCALE)!;
}

/**
 * First candidate tag actually known to `Intl`. Without this filter,
 * `Intl.PluralRules('co')` falls back to the process's default locale, i.e. to an unrelated
 * language, and singulars would be rendered as plurals.
 */
function firstSupported(
  api: { supportedLocalesOf(tags: string[]): string[] },
  candidates: readonly string[],
): string {
  for (const tag of candidates) {
    try {
      if (api.supportedLocalesOf([tag]).length > 0) return tag;
    } catch {
      /* malformed tag: move on to the next candidate */
    }
  }
  return BASE_LOCALE;
}

/** Tag to pass to `Intl.PluralRules` for this language. */
export function pluralTag(code: Locale): string {
  return firstSupported(Intl.PluralRules, localeInfo(code).intl.plural);
}

/** Tag to pass to date and number formatters. */
export function formatTag(code: Locale): string {
  return firstSupported(Intl.NumberFormat, localeInfo(code).intl.format);
}
