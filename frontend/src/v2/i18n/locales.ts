// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import registry from './locales.json';

/**
 * Language registry — typed view of `locales.json` (identical copy on the backend side).
 *
 * To add a language: an entry in `locales.json`, the code in the `Locale` union, and a
 * `messages/<code>.json`. `scripts/check-translations.mjs` refuses any mismatch between these
 * three sources and between the front-end and back-end registries.
 */
export type Locale =
  'en' | 'fr' | 'es' | 'de' | 'pt' | 'zh-Hans' | 'ko' | 'ja' | 'hi' | 'br' | 'eu' | 'co' | 'gsw-FR' | 'oc';

/** Display and formatting metadata of a language. */
export type LocaleInfo = {
  /** BCP-47 tag: identifier, file key and the document's `lang` attribute. */
  code: Locale;
  /** Endonym — the language announces itself in its own language in the selector. */
  native: string;
  /** English exonym, for the docs and the admin. */
  english: string;
  dir: 'ltr' | 'rtl';
  /** Regional language: flagged as such in the selector (ReView defends them). */
  regional: boolean;
  /** Catalogue produced by machine translation, not reviewed by a human. */
  machineTranslated: boolean;
  /**
   * Candidate tags for the `Intl` APIs, from most precise to safest: not every language in the
   * registry is in ICU (Corsican, Alsatian), and plural rules do not always follow the digit
   * conventions (Corsican pluralises like Italian but is written with French formats).
   */
  intl: { plural: string[]; format: string[] };
};

/** Reference language: it defines the full set of keys and serves as the universal fallback. */
export const BASE_LOCALE: Locale = registry.base as Locale;

export const LOCALES = registry.locales as readonly LocaleInfo[];

export const LOCALE_CODES: readonly Locale[] = LOCALES.map((l) => l.code);

const BY_CODE = new Map<string, LocaleInfo>(LOCALES.map((l) => [l.code, l]));

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && BY_CODE.has(value);
}

/** Metadata of a language (falls back to the base language if the code is unknown). */
export function localeInfo(code: Locale): LocaleInfo {
  return BY_CODE.get(code) ?? BY_CODE.get(BASE_LOCALE)!;
}

/**
 * Picks the first tag that `Intl` actually knows among the candidates.
 * Without this filter, `Intl.PluralRules('co')` silently falls back to the root and puts every
 * number in `other` — the singular forms would disappear.
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

/** Tag to pass to the number, date and list formatters. */
export function formatTag(code: Locale): string {
  return firstSupported(Intl.NumberFormat, localeInfo(code).intl.format);
}

/**
 * Is this path that of a share link — the page opened by someone outside the studio?
 *
 * The client portal starts in **English**, whatever the browser language, instead of negotiating
 * like the rest of the application. English is the working language of the pipelines: it is in
 * this language that the studio named its shots and, most often, wrote the notes the client is
 * going to read. A translated interface on top of English notes makes people read two languages
 * at once. The selector remains on offer, and the reader's choice wins afterwards — it is kept
 * on their device.
 *
 * The test looks for a **segment**, not a prefix: the application can be served under a base
 * path (`/review/client/…`). It is deliberately trivial — the preload script generated at build
 * time must replay it identically in plain JavaScript, and a rule that cannot be copied without
 * error is a rule that will diverge.
 */
export function isSharePath(pathname: string): boolean {
  return pathname.includes('/client/');
}

/**
 * Negotiates the best available language from the browser preferences.
 * `fr-CA` matches `fr`, `zh-CN` matches `zh-Hans`; otherwise falls back to the base language.
 */
export function negotiateLocale(preferred: readonly string[]): Locale {
  for (const raw of preferred) {
    const tag = raw.trim();
    if (!tag) continue;
    if (isLocale(tag)) return tag;

    const lower = tag.toLowerCase();
    const exact = LOCALE_CODES.find((c) => c.toLowerCase() === lower);
    if (exact) return exact;

    // `zh`, `zh-CN`, `zh-SG` → simplified Chinese; `zh-TW`/`zh-Hant` are not offered yet and
    // deliberately fall back to the base language.
    if (lower === 'zh' || lower.startsWith('zh-hans') || /^zh-(cn|sg|my)$/.test(lower)) {
      return 'zh-Hans';
    }

    const primary = lower.split('-')[0];
    const byPrimary = LOCALE_CODES.find((c) => c.toLowerCase().split('-')[0] === primary);
    if (byPrimary) return byPrimary;
  }
  return BASE_LOCALE;
}
