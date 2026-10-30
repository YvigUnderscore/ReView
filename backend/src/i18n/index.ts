// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { BASE_LOCALE, LOCALE_CODES, isLocale, pluralTag, type Locale } from './locales';
import en from './messages/en.json';
import fr from './messages/fr.json';
import es from './messages/es.json';
import de from './messages/de.json';
import pt from './messages/pt.json';
import zhHans from './messages/zh-Hans.json';
import ko from './messages/ko.json';
import ja from './messages/ja.json';
import hi from './messages/hi.json';
import br from './messages/br.json';
import eu from './messages/eu.json';
import co from './messages/co.json';
import gswFR from './messages/gsw-FR.json';
import oc from './messages/oc.json';

export * from './locales';

/**
 * Server-side translation: emails, notifications, messages meant for users.
 *
 * Same contract as the frontend (English as reference, cascading fallback, `{name}`
 * interpolation, CLDR plurals), but the catalogs are loaded in one block: they weigh a few
 * tens of kilobytes and the server serves several languages at once.
 *
 * These catalogs are **independent** of the frontend's: the server does not need UI labels,
 * and the UI does not need email templates.
 */

type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };
type Message = string | PluralForms;
type Catalog = Partial<Record<MessageKey, Message>>;

/** The set of translation keys, derived from the English reference catalog. */
export type MessageKey = keyof typeof en;

/** Values interpolated into a message; `count` selects the plural form. */
export type TParams = Record<string, string | number> & { count?: number };

const CATALOGS: Record<Locale, Catalog> = {
  en: en,
  fr: fr,
  es: es,
  de: de,
  pt: pt,
  'zh-Hans': zhHans,
  ko: ko,
  ja: ja,
  hi: hi,
  br: br,
  eu: eu,
  co: co,
  'gsw-FR': gswFR,
  oc: oc,
};

const PLACEHOLDER = /\{(\w+)\}/g;

function interpolate(text: string, params: TParams | undefined): string {
  if (!params) return text;
  return text.replace(PLACEHOLDER, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

function selectPlural(forms: PluralForms, count: number, locale: Locale): string {
  try {
    return forms[new Intl.PluralRules(pluralTag(locale)).select(count)] ?? forms.other;
  } catch {
    return forms.other;
  }
}

/**
 * Translates a key into the requested language, falling back to English key by key, so a
 * partial translation yields a readable email rather than a gappy one.
 */
export function t(locale: Locale, key: MessageKey, params?: TParams): string {
  // Typing does not protect against a language coming from the database (preference saved
  // before a language was removed from the registry): a degraded email beats a failed send.
  const own = CATALOGS[locale]?.[key];
  const message = own ?? CATALOGS[BASE_LOCALE][key];
  if (message === undefined) return key;
  if (typeof message === 'string') return interpolate(message, params);
  // Plural rules follow the language of the message actually used: an English fallback is
  // pluralised in English, not according to the rules of the requested language.
  const resolved = own === undefined ? BASE_LOCALE : locale;
  return interpolate(selectPlural(message, params?.count ?? 0, resolved), params);
}

/** The language chosen by an account in its preferences, if known to the registry. */
export function localeFromPreferences(preferences: unknown): Locale | null {
  if (!preferences || typeof preferences !== 'object') return null;
  const value = (preferences as Record<string, unknown>).locale;
  return isLocale(value) ? value : null;
}

/**
 * Language of an **unauthenticated** reader, negotiated from `Accept-Language`.
 *
 * The backend's public surfaces, first among them the `/api/docs` page, which AGPL section 13
 * requires to carry the source notice, have no account or saved preference to consult. Without
 * this negotiation their content was hard-coded: the legal notice on `/api/docs` was shown
 * **in French** to everyone, whereas the same notice is rendered in English by the frontend.
 * A legal notice whose language changes depending on the entry point is not a legal notice.
 *
 * Quality values (`;q=`) are honoured, and a regional tag falls back to its language:
 * `zh-CN` picks `zh-Hans`, `pt-BR` picks `pt`. Falls back to the base language.
 */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale {
  if (!header) return BASE_LOCALE;
  const ranked = header
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.find((p) => p.trim().startsWith('q='));
      const weight = q ? Number(q.trim().slice(2)) : 1;
      return { tag: tag.trim().toLowerCase(), weight: Number.isFinite(weight) ? weight : 0 };
    })
    .filter((r) => r.tag !== '' && r.tag !== '*' && r.weight > 0)
    // Stable sort: at equal quality, the order written decides, as RFC 9110 requires.
    .sort((a, b) => b.weight - a.weight);
  for (const { tag } of ranked) {
    const exact = LOCALE_CODES.find((c) => c.toLowerCase() === tag);
    if (exact) return exact;
    const base = tag.split('-')[0] ?? tag;
    const loose = LOCALE_CODES.find(
      (c) => c.toLowerCase() === base || c.toLowerCase().startsWith(`${base}-`),
    );
    if (loose) return loose;
  }
  return BASE_LOCALE;
}
