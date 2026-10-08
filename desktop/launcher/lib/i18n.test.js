// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { AVAILABLE, createT, pickLanguage } from './i18n.js';

const launcher = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(launcher, '..', '..');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const catalog = (lang) => JSON.parse(readFileSync(path.join(launcher, 'i18n', `${lang}.json`), 'utf8'));
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('pickLanguage', () => {
  it('suit la négociation de l’application web', () => {
    expect(pickLanguage(['fr-CA', 'en-US'])).toBe('fr');
    expect(pickLanguage(['de-DE'])).toBe('de');
    expect(pickLanguage(['zh-CN'])).toBe('zh-Hans');
    expect(pickLanguage(['zh'])).toBe('zh-Hans');
    expect(pickLanguage(['gsw'])).toBe('gsw-FR');
    expect(pickLanguage(['GSW-fr'])).toBe('gsw-FR');
    expect(pickLanguage(['it-IT', 'oc'])).toBe('oc');
    expect(pickLanguage(['it-IT'])).toBe('en');
    expect(pickLanguage(undefined)).toBe('en');
  });

  it('parle les quatorze langues de l’application, dans le même ordre', () => {
    const registry = readJson(path.join(repo, 'frontend/src/v2/i18n/locales.json'));
    expect(AVAILABLE).toEqual(registry.locales.map((l) => l.code));
    expect(registry.base).toBe('en');
  });
});

describe('createT', () => {
  const t = createT({ a: 'Bonjour {name}' }, { a: 'Hello {name}', b: 'Only {x}' });
  it('traduit, retombe sur l’anglais clé par clé, puis sur la clé', () => {
    expect(t('a', { name: 'Yvig' })).toBe('Bonjour Yvig');
    expect(t('b', { x: 1 })).toBe('Only 1');
    expect(t('c')).toBe('c');
  });
  it('laisse visible une variable non fournie plutôt que de l’effacer', () => {
    expect(t('a')).toBe('Bonjour {name}');
  });
});

describe('catalogues', () => {
  const en = catalog('en');

  it('chaque langue a un catalogue complet : ni clé manquante, ni clé inconnue', () => {
    for (const lang of AVAILABLE) {
      const keys = Object.keys(catalog(lang));
      expect([lang, keys.filter((k) => !(k in en))]).toEqual([lang, []]);
      expect([lang, Object.keys(en).filter((k) => !keys.includes(k))]).toEqual([lang, []]);
    }
  });

  it('le vocabulaire de production n’est traduit dans aucune langue', () => {
    // Même règle que check-translations.mjs : un terme du glossaire présent dans le
    // message anglais (début de mot, casse ignorée) se retrouve dans chaque traduction.
    const { terms } = readJson(path.join(repo, 'scripts/i18n-glossary.json'));
    const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const has = (term, text) => new RegExp(`(^|[^\\p{L}\\p{N}])${escape(term)}`, 'iu').test(text);
    for (const lang of AVAILABLE) {
      const c = catalog(lang);
      for (const [key, text] of Object.entries(en)) {
        for (const term of terms.filter((t) => has(t, text))) {
          expect([lang, key, term, has(term, c[key])]).toEqual([lang, key, term, true]);
        }
      }
    }
  });

  it('une traduction garde les variables de l’anglais', () => {
    for (const lang of AVAILABLE) {
      for (const [key, text] of Object.entries(catalog(lang))) {
        expect([key, placeholders(text)]).toEqual([key, placeholders(en[key])]);
      }
    }
  });

  it('toute clé appelée par le code existe en anglais', () => {
    const files = ['app.js', ...readdirSync(path.join(launcher, 'views')).map((f) => `views/${f}`)].filter(
      (f) => f.endsWith('.js') && !f.endsWith('.test.js'),
    );
    const used = new Set();
    for (const f of files) {
      const src = readFileSync(path.join(launcher, f), 'utf8');
      for (const m of src.matchAll(/\bt\('([\w.]+)'/g)) used.add(m[1]);
      // Table des erreurs de connexion : clés passées à `t` par variable.
      for (const m of src.matchAll(/'(error\.\w+)'/g)) used.add(m[1]);
      // Clés composées des cartes du mode : `${mode.key}.title`…
      for (const m of src.matchAll(/key: '([\w.]+)'/g)) {
        for (const part of ['title', 'desc', 'disk', 'shared', 'close']) used.add(`${m[1]}.${part}`);
      }
    }
    expect([...used].filter((k) => !(k in en))).toEqual([]);
  });
});
