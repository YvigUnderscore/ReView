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
  it('a l’anglais pour langue de base', () => {
    expect(BASE_LOCALE).toBe('en');
  });

  it('déclare les quatorze langues', () => {
    expect(LOCALE_CODES).toHaveLength(14);
    expect(LOCALE_CODES).toContain('gsw-FR');
  });

  it('ne signale que l’anglais comme non issu d’une machine', () => {
    expect(LOCALES.filter((l) => !l.machineTranslated).map((l) => l.code)).toEqual(['en']);
  });

  it('retient des étiquettes Intl réellement connues', () => {
    for (const code of LOCALE_CODES) {
      expect(Intl.PluralRules.supportedLocalesOf([pluralTag(code)]).length).toBeGreaterThan(0);
      expect(Intl.DateTimeFormat.supportedLocalesOf([formatTag(code)]).length).toBeGreaterThan(0);
    }
  });

  it('reconnaît les codes du registre', () => {
    expect(isLocale('oc')).toBe(true);
    expect(isLocale('xx')).toBe(false);
  });
});

describe('traduction serveur', () => {
  it('traduit dans la langue demandée', () => {
    expect(t('en', 'weekly.title')).toBe('Weekly production report');
    expect(t('fr', 'weekly.title')).toBe('Rapport hebdomadaire de production');
    expect(t('eu', 'weekly.title')).toBe('Asteko produkzio-txostena');
  });

  it('interpole les variables', () => {
    expect(t('en', 'digest.by', { name: 'Ada' })).toBe('by Ada');
    expect(t('fr', 'digest.by', { name: 'Ada' })).toBe('par Ada');
  });

  it('laisse la variable en place quand elle n’est pas fournie', () => {
    expect(t('en', 'digest.by')).toBe('by {name}');
  });

  it('rend la clé elle-même si elle n’existe pas', () => {
    expect(t('en', 'nope.nope' as never)).toBe('nope.nope');
  });

  // Chaque catalogue est complet aujourd'hui ; le repli doit malgré tout tenir, sinon
  // ajouter une clé sans traduire les treize langues casserait tous les emails.
  it('sert chaque clé dans chaque langue, au besoin par repli', () => {
    const keys = Object.keys(enMessages) as MessageKey[];
    for (const code of LOCALE_CODES) {
      for (const key of keys) expect(t(code, key).trim().length).toBeGreaterThan(0);
    }
  });
});

describe('langue d’un destinataire', () => {
  it('lit le choix enregistré dans les préférences', () => {
    expect(localeFromPreferences({ locale: 'ja' })).toBe('ja');
  });

  it('ignore une langue inconnue ou une préférence absente', () => {
    expect(localeFromPreferences({ locale: 'kl' })).toBeNull();
    expect(localeFromPreferences({})).toBeNull();
    expect(localeFromPreferences(null)).toBeNull();
    expect(localeFromPreferences('fr')).toBeNull();
  });
});

describe('localeFromAcceptLanguage', () => {
  it('retombe sur la langue de base sans en-tête', () => {
    expect(localeFromAcceptLanguage(undefined)).toBe('en');
    expect(localeFromAcceptLanguage(null)).toBe('en');
    expect(localeFromAcceptLanguage('')).toBe('en');
  });

  it('reconnaît un code exact', () => {
    expect(localeFromAcceptLanguage('fr')).toBe('fr');
    expect(localeFromAcceptLanguage('zh-Hans')).toBe('zh-Hans');
  });

  it('retombe d’un tag régional sur la langue', () => {
    expect(localeFromAcceptLanguage('pt-BR')).toBe('pt');
    expect(localeFromAcceptLanguage('zh-CN')).toBe('zh-Hans');
    expect(localeFromAcceptLanguage('fr-CA,fr;q=0.9')).toBe('fr');
  });

  it('respecte les qualités', () => {
    expect(localeFromAcceptLanguage('de;q=0.3, ja;q=0.9')).toBe('ja');
    expect(localeFromAcceptLanguage('xx;q=1.0, es;q=0.5')).toBe('es');
  });

  it('ignore une langue refusée et le joker', () => {
    expect(localeFromAcceptLanguage('fr;q=0, ko')).toBe('ko');
    expect(localeFromAcceptLanguage('*')).toBe('en');
  });

  it('retombe sur la base quand rien n’est connu', () => {
    expect(localeFromAcceptLanguage('xx-YY, zz')).toBe('en');
  });
});
