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
  it('relève les variables interpolées', () => {
    expect(placeholders('{translated} sur {total}')).toEqual(new Set(['translated', 'total']));
  });

  it('rend un ensemble vide sans variable', () => {
    expect(placeholders('Bonjour')).toEqual(new Set());
  });

  it('ignore les accolades qui n’encadrent pas un identifiant', () => {
    expect(placeholders('{ } {-}')).toEqual(new Set());
  });
});

describe('normalizeMessage', () => {
  it('range une chaîne simple sous « other »', () => {
    expect(normalizeMessage('Bonjour')).toEqual({ other: 'Bonjour' });
  });

  it('laisse les formes plurielles telles quelles', () => {
    expect(normalizeMessage({ one: 'a', other: 'b' })).toEqual({ one: 'a', other: 'b' });
  });
});

describe('resolveIntlTag', () => {
  it('retient la première étiquette connue d’Intl', () => {
    expect(resolveIntlTag(['fr'])).toBe('fr');
  });

  it('passe à la candidate suivante quand la langue est absente d’ICU', () => {
    expect(resolveIntlTag(['zz-nope', 'de'])).toBe('de');
  });

  it('retombe sur l’anglais quand aucune candidate n’est connue', () => {
    expect(resolveIntlTag(['zz-nope', 'qq-nope'])).toBe('en');
  });

  it('survit à une étiquette mal formée', () => {
    expect(resolveIntlTag(['!!!', 'fr'])).toBe('fr');
  });
});

describe('supportedCategories', () => {
  it('rend « other » seul pour le japonais', () => {
    expect(supportedCategories('ja')).toEqual(['other']);
  });

  it('distingue le singulier en anglais', () => {
    expect(supportedCategories('en')).toContain('one');
  });

  it('ne rend que des catégories CLDR connues', () => {
    for (const c of supportedCategories('fr')) expect(CLDR_CATEGORIES).toContain(c);
  });
});

describe('glossaryHits', () => {
  it('reconnaît le terme au pluriel', () => {
    expect(glossaryHits('vos reviews et boards', TERMS)).toContain('board');
  });

  it('reconnaît le terme suffixé par une langue agglutinante', () => {
    expect(glossaryHits('boardetara itzultzeko', TERMS)).toContain('board');
  });

  it('reconnaît le terme collé à un caractère non latin', () => {
    expect(glossaryHits('作業、board로 돌아가세요', TERMS)).toContain('board');
  });

  it('ignore la casse', () => {
    expect(glossaryHits('Bienvenue sur ReView', ['review'])).toEqual(['review']);
  });

  it('ne déclenche pas sur une fin de mot', () => {
    expect(glossaryHits('skateboard', ['board'])).toEqual([]);
  });
});

describe('sameRegistry', () => {
  it('ignore les clés de commentaire', () => {
    expect(sameRegistry({ $comment: 'a', base: 'en' }, { base: 'en' })).toBe(true);
  });

  it('repère une langue en écart', () => {
    expect(sameRegistry({ locales: ['en'] }, { locales: ['en', 'fr'] })).toBe(false);
  });
});

describe('localeUnionCodes', () => {
  it('extrait les codes de l’union TypeScript', () => {
    const source = "export type Locale =\n  | 'en'\n  | 'zh-Hans';\n\nexport const X = 1;";
    expect(localeUnionCodes(source)).toEqual(['en', 'zh-Hans']);
  });

  it('rend null quand l’union est absente', () => {
    expect(localeUnionCodes('export const X = 1;')).toBeNull();
  });
});

describe('checkCatalog', () => {
  it('accepte une traduction conforme et compte les clés traduites', () => {
    const r = check({ a: 'Hello {name}', b: 'Bye' }, { a: 'Bonjour {name}' });
    expect(r.errors).toEqual([]);
    expect(r.translated).toBe(1);
  });

  it('refuse une variable perdue', () => {
    const r = check({ a: 'Hello {name}' }, { a: 'Bonjour' });
    expect(r.errors.join()).toMatch(/perd la variable \{name\}/);
  });

  it('refuse une variable inventée', () => {
    const r = check({ a: 'Hello' }, { a: 'Bonjour {name}' });
    expect(r.errors.join()).toMatch(/invente la variable \{name\}/);
  });

  it('refuse une clé absente de la référence', () => {
    const r = check({ a: 'Hello' }, { a: 'Bonjour', zzz: 'Orpheline' });
    expect(r.errors.join()).toMatch(/« zzz » absente du catalogue de référence/);
  });

  it('refuse un message compté rendu par une chaîne simple', () => {
    const r = check({ a: { one: '{n} item', other: '{n} items' } }, { a: '{n} éléments' });
    expect(r.errors.join()).toMatch(/attend des formes plurielles/);
  });

  it('refuse des formes plurielles sans « other »', () => {
    const r = check({ a: { one: '{n} item', other: '{n} items' } }, { a: { one: '{n} élément' } });
    expect(r.errors.join()).toMatch(/n'a pas de forme « other »/);
  });

  it('refuse une forme hors CLDR', () => {
    const r = check({ a: { other: '{n} items' } }, { a: { plural: '{n} éléments', other: '{n} éléments' } });
    expect(r.errors.join()).toMatch(/forme inconnue « plural »/);
  });

  it('refuse une forme que la langue ne distingue pas', () => {
    const r = check({ a: { one: '{n} item', other: '{n} items' } }, { a: { one: '1 件', other: '{n} 件' } }, {
      categories: ['other'],
    });
    expect(r.errors.join()).toMatch(/définit « one », que cette langue ne distingue pas/);
  });

  it('refuse un terme métier traduit', () => {
    const r = check({ a: 'Open the shot' }, { a: 'Ouvrir le plan' });
    expect(r.errors.join()).toMatch(/terme métier « shot »/);
  });

  it('accepte un terme métier conservé au pluriel', () => {
    const r = check({ a: 'Your dailies' }, { a: 'Vos dailies' });
    expect(r.errors).toEqual([]);
  });

  it('refuse un message vide', () => {
    const r = check({ a: 'Hello' }, { a: '   ' });
    expect(r.errors.join()).toMatch(/est vide/);
  });

  it('signale sans bloquer une forme plurielle manquante', () => {
    const r = check({ a: { one: '{n} item', other: '{n} items' } }, { a: { other: '{n} éléments' } });
    expect(r.errors).toEqual([]);
    expect(r.warnings.join()).toMatch(/n'a pas de forme « one »/);
  });

  it('ne réclame pas de formes plurielles sur une phrase ordinaire', () => {
    const r = check({ a: 'Hello' }, { a: 'Bonjour' });
    expect(r.warnings).toEqual([]);
  });

  it('tolère une traduction partielle', () => {
    const r = check({ a: 'Hello', b: 'Bye', c: 'Ciao' }, { a: 'Bonjour' });
    expect(r.errors).toEqual([]);
    expect(r.translated).toBe(1);
  });
});
