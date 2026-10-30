// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  CLDR_CATEGORIES,
  checkCatalog,
  glossaryHits,
  localeUnionCodes,
  normalizeMessage,
  placeholders,
  resolveIntlTag,
  sameRegistry,
  supportedCategories,
} from './check-translations.mjs';

const TERMS = ['ReView', 'review', 'shot', 'board', 'dailies'];
const check = (base, target, options = {}) =>
  checkCatalog({
    base,
    target,
    locale: 'xx',
    categories: options.categories ?? ['one', 'other'],
    terms: options.terms ?? TERMS,
  });

describe('placeholders', () => {
  it('reports the interpolated variables', () => {
    expect(placeholders('{translated} sur {total}')).toEqual(new Set(['translated', 'total']));
  });

  it('returns an empty set when there is no variable', () => {
    expect(placeholders('Bonjour')).toEqual(new Set());
  });

  it('ignores braces that do not enclose an identifier', () => {
    expect(placeholders('{ } {-}')).toEqual(new Set());
  });
});

describe('normalizeMessage', () => {
  it('files a plain string under "other"', () => {
    expect(normalizeMessage('Bonjour')).toEqual({ other: 'Bonjour' });
  });

  it('leaves plural forms as they are', () => {
    expect(normalizeMessage({ one: 'a', other: 'b' })).toEqual({ one: 'a', other: 'b' });
  });
});

describe('resolveIntlTag', () => {
  it('keeps the first tag known to Intl', () => {
    expect(resolveIntlTag(['fr'])).toBe('fr');
  });

  it('moves on to the next candidate when the language is absent from ICU', () => {
    expect(resolveIntlTag(['zz-nope', 'de'])).toBe('de');
  });

  it('falls back to English when no candidate is known', () => {
    expect(resolveIntlTag(['zz-nope', 'qq-nope'])).toBe('en');
  });

  it('survives a malformed tag', () => {
    expect(resolveIntlTag(['!!!', 'fr'])).toBe('fr');
  });
});

describe('supportedCategories', () => {
  it('returns "other" alone for Japanese', () => {
    expect(supportedCategories('ja')).toEqual(['other']);
  });

  it('distinguishes the singular in English', () => {
    expect(supportedCategories('en')).toContain('one');
  });

  it('only returns known CLDR categories', () => {
    for (const c of supportedCategories('fr')) expect(CLDR_CATEGORIES).toContain(c);
  });
});

describe('glossaryHits', () => {
  it('recognises the term in the plural', () => {
    expect(glossaryHits('vos reviews et boards', TERMS)).toContain('board');
  });

  it('recognises the term suffixed by an agglutinative language', () => {
    expect(glossaryHits('boardetara itzultzeko', TERMS)).toContain('board');
  });

  it('recognises the term attached to a non-Latin character', () => {
    expect(glossaryHits('作業、board로 돌아가세요', TERMS)).toContain('board');
  });

  it('ignores case', () => {
    expect(glossaryHits('Bienvenue sur ReView', ['review'])).toEqual(['review']);
  });

  it('does not trigger on the end of a word', () => {
    expect(glossaryHits('skateboard', ['board'])).toEqual([]);
  });
});

describe('sameRegistry', () => {
  it('ignores the comment keys', () => {
    expect(sameRegistry({ $comment: 'a', base: 'en' }, { base: 'en' })).toBe(true);
  });

  it('spots a language that has drifted', () => {
    expect(sameRegistry({ locales: ['en'] }, { locales: ['en', 'fr'] })).toBe(false);
  });
});

describe('localeUnionCodes', () => {
  it('extracts the codes of the TypeScript union', () => {
    const source = "export type Locale =\n  | 'en'\n  | 'zh-Hans';\n\nexport const X = 1;";
    expect(localeUnionCodes(source)).toEqual(['en', 'zh-Hans']);
  });

  it('returns null when the union is absent', () => {
    expect(localeUnionCodes('export const X = 1;')).toBeNull();
  });
});

describe('checkCatalog', () => {
  it('accepts a compliant translation and counts the translated keys', () => {
    const r = check({ a: 'Hello {name}', b: 'Bye' }, { a: 'Bonjour {name}' });
    expect(r.errors).toEqual([]);
    expect(r.translated).toBe(1);
  });

  it('refuses a lost variable', () => {
    const r = check({ a: 'Hello {name}' }, { a: 'Bonjour' });
    expect(r.errors.join()).toMatch(/perd la variable \{name\}/);
  });

  it('refuses an invented variable', () => {
    const r = check({ a: 'Hello' }, { a: 'Bonjour {name}' });
    expect(r.errors.join()).toMatch(/invente la variable \{name\}/);
  });

  it('refuses a key absent from the reference', () => {
    const r = check({ a: 'Hello' }, { a: 'Bonjour', zzz: 'Orpheline' });
    expect(r.errors.join()).toMatch(/« zzz » absente du catalogue de référence/);
  });

  it('refuses a counted message rendered as a plain string', () => {
    const r = check({ a: { one: '{n} item', other: '{n} items' } }, { a: '{n} éléments' });
    expect(r.errors.join()).toMatch(/attend des formes plurielles/);
  });

  it('refuses plural forms without "other"', () => {
    const r = check({ a: { one: '{n} item', other: '{n} items' } }, { a: { one: '{n} élément' } });
    expect(r.errors.join()).toMatch(/n'a pas de forme « other »/);
  });

  it('refuses a form outside CLDR', () => {
    const r = check({ a: { other: '{n} items' } }, { a: { plural: '{n} éléments', other: '{n} éléments' } });
    expect(r.errors.join()).toMatch(/forme inconnue « plural »/);
  });

  it('refuses a form the language does not distinguish', () => {
    const r = check(
      { a: { one: '{n} item', other: '{n} items' } },
      { a: { one: '1 件', other: '{n} 件' } },
      {
        categories: ['other'],
      },
    );
    expect(r.errors.join()).toMatch(/définit « one », que cette langue ne distingue pas/);
  });

  it('refuses a translated business term', () => {
    const r = check({ a: 'Open the shot' }, { a: 'Ouvrir le plan' });
    expect(r.errors.join()).toMatch(/terme métier « shot »/);
  });

  it('accepts a business term kept in the plural', () => {
    const r = check({ a: 'Your dailies' }, { a: 'Vos dailies' });
    expect(r.errors).toEqual([]);
  });

  it('refuses an empty message', () => {
    const r = check({ a: 'Hello' }, { a: '   ' });
    expect(r.errors.join()).toMatch(/est vide/);
  });

  it('reports a missing plural form without blocking', () => {
    const r = check({ a: { one: '{n} item', other: '{n} items' } }, { a: { other: '{n} éléments' } });
    expect(r.errors).toEqual([]);
    expect(r.warnings.join()).toMatch(/n'a pas de forme « one »/);
  });

  it('does not demand plural forms for an ordinary sentence', () => {
    const r = check({ a: 'Hello' }, { a: 'Bonjour' });
    expect(r.warnings).toEqual([]);
  });

  it('tolerates a partial translation', () => {
    const r = check({ a: 'Hello', b: 'Bye', c: 'Ciao' }, { a: 'Bonjour' });
    expect(r.errors).toEqual([]);
    expect(r.translated).toBe(1);
  });
});
