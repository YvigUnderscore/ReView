// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  BASE_LOCALE,
  LOCALES,
  LOCALE_CODES,
  formatTag,
  isLocale,
  localeFromAcceptLanguage,
  localeFromPreferences,
  pluralTag,
  t,
  type MessageKey,
} from './index';
import enMessages from './messages/en.json';

describe('registre serveur', () => {
  it('English is the base language', () => {
    expect(BASE_LOCALE).toBe('en');
  });

  it('declares the fourteen languages', () => {
    expect(LOCALE_CODES).toHaveLength(14);
    expect(LOCALE_CODES).toContain('gsw-FR');
  });

  it('flags only English as not machine-derived', () => {
    expect(LOCALES.filter((l) => !l.machineTranslated).map((l) => l.code)).toEqual(['en']);
  });

  it('keeps Intl labels that are actually known', () => {
    for (const code of LOCALE_CODES) {
      expect(Intl.PluralRules.supportedLocalesOf([pluralTag(code)]).length).toBeGreaterThan(0);
      expect(Intl.DateTimeFormat.supportedLocalesOf([formatTag(code)]).length).toBeGreaterThan(0);
    }
  });

  it('recognises the registry codes', () => {
    expect(isLocale('oc')).toBe(true);
    expect(isLocale('xx')).toBe(false);
  });
});

describe('traduction serveur', () => {
  it('translates into the requested language', () => {
    expect(t('en', 'weekly.title')).toBe('Weekly production report');
    expect(t('fr', 'weekly.title')).toBe('Rapport hebdomadaire de production');
    expect(t('eu', 'weekly.title')).toBe('Asteko produkzio-txostena');
  });

  it('interpolates the variables', () => {
    expect(t('en', 'digest.by', { name: 'Ada' })).toBe('by Ada');
    expect(t('fr', 'digest.by', { name: 'Ada' })).toBe('par Ada');
  });

  it('leaves the variable in place when it is not supplied', () => {
    expect(t('en', 'digest.by')).toBe('by {name}');
  });

  it('returns the key itself when it does not exist', () => {
    expect(t('en', 'nope.nope' as never)).toBe('nope.nope');
  });

  // Every catalog is complete today; the fallback must still hold, otherwise adding a key
  // without translating all thirteen languages would break every email.
  it('serves each key in each language, falling back where needed', () => {
    const keys = Object.keys(enMessages) as MessageKey[];
    for (const code of LOCALE_CODES) {
      for (const key of keys) expect(t(code, key).trim().length).toBeGreaterThan(0);
    }
  });
});

describe('recipient language', () => {
  it('reads the choice saved in the preferences', () => {
    expect(localeFromPreferences({ locale: 'ja' })).toBe('ja');
  });

  it('ignores an unknown language or an absent preference', () => {
    expect(localeFromPreferences({ locale: 'kl' })).toBeNull();
    expect(localeFromPreferences({})).toBeNull();
    expect(localeFromPreferences(null)).toBeNull();
    expect(localeFromPreferences('fr')).toBeNull();
  });
});

describe('localeFromAcceptLanguage', () => {
  it('falls back on the base language without a header', () => {
    expect(localeFromAcceptLanguage(undefined)).toBe('en');
    expect(localeFromAcceptLanguage(null)).toBe('en');
    expect(localeFromAcceptLanguage('')).toBe('en');
  });

  it('recognises an exact code', () => {
    expect(localeFromAcceptLanguage('fr')).toBe('fr');
    expect(localeFromAcceptLanguage('zh-Hans')).toBe('zh-Hans');
  });

  it('falls back from a regional tag to the language', () => {
    expect(localeFromAcceptLanguage('pt-BR')).toBe('pt');
    expect(localeFromAcceptLanguage('zh-CN')).toBe('zh-Hans');
    expect(localeFromAcceptLanguage('fr-CA,fr;q=0.9')).toBe('fr');
  });

  it('honours the qualities', () => {
    expect(localeFromAcceptLanguage('de;q=0.3, ja;q=0.9')).toBe('ja');
    expect(localeFromAcceptLanguage('xx;q=1.0, es;q=0.5')).toBe('es');
  });

  it('ignores a refused language and the wildcard', () => {
    expect(localeFromAcceptLanguage('fr;q=0, ko')).toBe('ko');
    expect(localeFromAcceptLanguage('*')).toBe('en');
  });

  it('falls back on the base when nothing is known', () => {
    expect(localeFromAcceptLanguage('xx-YY, zz')).toBe('en');
  });
});
