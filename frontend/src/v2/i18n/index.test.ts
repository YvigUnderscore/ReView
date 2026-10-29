// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localesCoveringBaseCatalog } from '../../../vite.config.js';
import {
  BASE_LOCALE,
  LOCALES,
  LOCALE_CODES,
  coverage,
  formatTag,
  getLocale,
  isSharePath,
  hasMessage,
  isLocale,
  loadCatalog,
  localeInfo,
  localeSnapshot,
  subscribeToLocale,
  negotiateLocale,
  pluralTag,
  setLocale,
  t,
  type Locale,
} from './index';

/** All catalogues, loaded in one block for the cross-cutting checks. */
const catalogs = import.meta.glob<{ default: Record<string, unknown> }>('./messages/*.json', {
  eager: true,
});
const catalogOf = (code: Locale) => catalogs[`./messages/${code}.json`].default;

describe('language registry', () => {
  it('has English as its base language', () => {
    expect(BASE_LOCALE).toBe('en');
  });

  it('declares the fourteen expected languages', () => {
    expect(LOCALE_CODES).toEqual([
      'en',
      'fr',
      'es',
      'de',
      'pt',
      'zh-Hans',
      'ko',
      'ja',
      'hi',
      'br',
      'eu',
      'co',
      'gsw-FR',
      'oc',
    ]);
  });

  it('provides a catalogue for each declared language', () => {
    for (const code of LOCALE_CODES) expect(catalogs[`./messages/${code}.json`]).toBeDefined();
  });

  it('flags only English as not machine-generated', () => {
    const authored = LOCALES.filter((l) => !l.machineTranslated).map((l) => l.code);
    expect(authored).toEqual(['en']);
  });

  it('classifies the five regional languages', () => {
    expect(LOCALES.filter((l) => l.regional).map((l) => l.code)).toEqual(['br', 'eu', 'co', 'gsw-FR', 'oc']);
  });

  it('announces each language in its own language', () => {
    for (const l of LOCALES) expect(l.native.trim().length).toBeGreaterThan(0);
    expect(localeInfo('ja').native).toBe('日本語');
  });

  it('recognises the registry codes and rejects the others', () => {
    expect(isLocale('gsw-FR')).toBe(true);
    expect(isLocale('kl')).toBe(false);
    expect(isLocale(null)).toBe(false);
  });
});

describe('Intl label resolution', () => {
  it('picks a label that Intl actually knows for each language', () => {
    for (const code of LOCALE_CODES) {
      expect(Intl.PluralRules.supportedLocalesOf([pluralTag(code)]).length).toBeGreaterThan(0);
      expect(Intl.NumberFormat.supportedLocalesOf([formatTag(code)]).length).toBeGreaterThan(0);
    }
  });

  it('pluralises Corsican like Italian, not like the root', () => {
    expect(new Intl.PluralRules(pluralTag('co')).select(1)).toBe('one');
  });

  it('gives regional languages their own formats when ICU knows them', () => {
    // CLDR carries Breton ("Eost") and Occitan ("d'agost") month names: overriding them with
    // `fr` would have displayed a French month in the middle of a Breton sentence.
    expect(formatTag('br')).toBe('br');
    expect(formatTag('oc')).toBe('oc');
  });

  it('falls back to French for regional languages missing from ICU', () => {
    // `co` has no ICU data; `gsw` does, but Swiss (’ separator, YYYY MMM DD order) — Corsica and
    // Alsace read French dates.
    expect(formatTag('co')).toBe('fr');
    expect(formatTag('gsw-FR')).toBe('fr');
  });

  it('leaves Basque to its own conventions', () => {
    expect(formatTag('eu')).toBe('eu');
  });
});

describe('negotiation from the browser', () => {
  it('keeps an exact match', () => {
    expect(negotiateLocale(['fr'])).toBe('fr');
  });

  it('maps a regional variant back to its language', () => {
    expect(negotiateLocale(['fr-CA'])).toBe('fr');
    expect(negotiateLocale(['pt-BR'])).toBe('pt');
  });

  it('maps mainland Chinese to simplified', () => {
    expect(negotiateLocale(['zh-CN'])).toBe('zh-Hans');
    expect(negotiateLocale(['zh'])).toBe('zh-Hans');
  });

  it('follows the order of the browser preference', () => {
    expect(negotiateLocale(['kl', 'eu', 'fr'])).toBe('eu');
  });

  it('falls back to English when nothing matches', () => {
    expect(negotiateLocale(['kl-GL'])).toBe('en');
    expect(negotiateLocale([])).toBe('en');
  });
});

/**
 * The client portal starts in English whatever the reader's browser: it is the language in which
 * the studio named its shots and wrote the notes the client is going to read. A translated
 * interface on top of English notes makes people read two languages at once. The selector stays
 * on offer, and the choice made there wins afterwards.
 */
describe('share link — English by default', () => {
  it('recognises a share link, including under a base path', () => {
    expect(isSharePath('/client/abc123')).toBe(true);
    expect(isSharePath('/review/client/abc123')).toBe(true);
  });

  it('does not confuse an application page with a share link', () => {
    for (const path of ['/projects/7', '/', '/clients', '/reviews/12']) {
      expect(isSharePath(path)).toBe(false);
    }
  });
});

describe('translation', () => {
  beforeEach(async () => {
    localStorage.clear();
    await setLocale('en');
  });

  it('starts in English', () => {
    expect(getLocale()).toBe('en');
    expect(t('login.submit')).toBe('Sign in');
  });

  it('switches language and persists the choice', async () => {
    await setLocale('ja');
    expect(getLocale()).toBe('ja');
    expect(t('login.submit')).toBe('ログイン');
    expect(localStorage.getItem('locale')).toBe('ja');
  });

  it('ignores a language absent from the registry', async () => {
    await setLocale('eu');
    await setLocale('kl' as Locale);
    expect(getLocale()).toBe('eu');
  });

  it('falls back to English when the key is not translated', async () => {
    await setLocale('br');
    // Truncated catalogue: the key disappears, and the English fallback must take over.
    const catalog = catalogOf('br') as Record<string, string>;
    const saved = catalog['common.save'];
    delete catalog['common.save'];
    expect(t('common.save')).toBe('Save');
    catalog['common.save'] = saved!;
  });

  it('returns the key itself if it exists nowhere', () => {
    expect(t('nope.nope' as never)).toBe('nope.nope');
  });

  /**
   * A constructed key (`error.${code}` for an API error code) may designate nothing: the caller
   * must be able to know it before displaying the key on screen.
   */
  it('says whether a constructed key exists in the catalogue', () => {
    expect(hasMessage('common.save')).toBe(true);
    expect(hasMessage('error.CODE_QUI_N_EXISTE_PAS')).toBe(false);
    expect(hasMessage('')).toBe(false);
  });

  it('interpolates variables', async () => {
    await setLocale('fr');
    expect(t('language.coverage', { count: 12, translated: 12, total: 67 })).toBe(
      '12 phrases traduites sur 67',
    );
  });

  it('leaves the variable in place when it is not supplied', () => {
    expect(t('language.coverage', { count: 2 })).toContain('{translated}');
  });

  it('inflects the plural according to the language', async () => {
    await setLocale('en');
    expect(t('language.coverage', { count: 1, translated: 1, total: 67 })).toBe('1 of 67 phrase translated');
    expect(t('language.coverage', { count: 2, translated: 2, total: 67 })).toBe('2 of 67 phrases translated');
    // French puts zero in the singular, English in the plural.
    await setLocale('fr');
    expect(t('language.coverage', { count: 0, translated: 0, total: 67 })).toBe('0 phrase traduite sur 67');
  });

  it('serves a single form to languages without a plural', async () => {
    await setLocale('ja');
    expect(t('language.coverage', { count: 1, translated: 1, total: 67 })).toBe('67 件中 1 件を翻訳済み');
    expect(t('language.coverage', { count: 5, translated: 5, total: 67 })).toBe('67 件中 5 件を翻訳済み');
  });

  it('counts the coverage of a loaded catalogue', async () => {
    await loadCatalog('oc');
    const stats = coverage('oc');
    expect(stats).not.toBeNull();
    expect(stats!.translated).toBe(stats!.total);
  });

  // Regression: the snapshot was the language itself. When the catalogue arrived, the language
  // already held its new value, React short-circuited the render and the screen stayed frozen on
  // the English fallback — visible when switching to a language never loaded before.
  it('changes snapshot on each notification, catalogue included', async () => {
    await setLocale('en');
    const seen: number[] = [];
    const unsubscribe = subscribeToLocale(() => seen.push(localeSnapshot()));
    await setLocale('co');
    unsubscribe();
    expect(seen.length).toBe(2); // immediate switch, then catalogue arrival
    expect(new Set(seen).size).toBe(2); // two distinct snapshots, otherwise no render
    expect(t('common.save')).toBe('Arregistrà');
  });

  it('aligns the document lang attribute with the language', async () => {
    await setLocale('zh-Hans');
    expect(document.documentElement.lang).toBe('zh-Hans');
    expect(document.documentElement.dir).toBe('ltr');
  });
});

/**
 * What the browser downloads before the first screen (F1).
 *
 * Measured at build time, on the same tree, with `vite build` run twice: with English inlined,
 * 310.2 kB gzip of first load (entry chunk 176.2); without, 258.6 kB (entry chunk 124.7) —
 * **51.5 kB gzip, 16.6%**, plus an `en-*.js` chunk of 51.0 kB that only incomplete languages go
 * and fetch. The tests that follow keep both conditions of that saving: no catalogue in the entry
 * chunk, and a list of complete languages that tells the truth — otherwise a partial translation
 * would show raw keys instead of the English fallback.
 */
describe('first-load weight', () => {
  // `process.cwd()` is the root of the frontend project, the one vitest uses.
  const source = readFileSync(path.join(process.cwd(), 'src/v2/i18n/index.ts'), 'utf8');

  it('statically imports no catalogue: they all arrive through their chunk', () => {
    const inlines = [...source.matchAll(/^import\s[^\n]*?from\s+'\.\/messages\/[^']+'/gm)];
    expect(inlines.map((m) => m[0])).toEqual([]);
  });

  it('leaves the fourteen catalogues loadable on demand', async () => {
    for (const code of LOCALE_CODES) {
      await loadCatalog(code);
      expect(coverage(code), code).not.toBeNull();
    }
  });

  /**
   * The list is computed by `vite.config.js` by reading the files; the bundle, for its part,
   * serves the modules Vite has seen. The two views must coincide: a language wrongly declared
   * complete would no longer fetch English, and its missing keys would be displayed as-is.
   */
  it('declares complete only a language that truly covers all the keys', () => {
    const baseKeys = Object.keys(catalogOf(BASE_LOCALE));
    const reallyComplete = LOCALE_CODES.filter(
      (code) => code !== BASE_LOCALE && baseKeys.every((k) => catalogOf(code)[k] !== undefined),
    );
    expect([...localesCoveringBaseCatalog()].sort()).toEqual([...reallyComplete].sort());
  });
});

/**
 * The core embeds the base catalogue **outside production** — otherwise the tests, which do not
 * bootstrap the application, would have no message to translate. The cases that follow therefore
 * replay the production conditions (`PROD` true, no catalogue in memory) on a fresh instance of
 * the module, and count what is actually downloaded: one catalogue, or two. `coverage(code)` is
 * `null` until a catalogue has arrived — that is our request counter.
 */
describe('under production conditions: number of catalogues downloaded', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    localStorage.clear();
  });

  const freshI18n = async (fullLocales: string) => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('I18N_FULL_LOCALES', fullLocales);
    vi.resetModules();
    return import('./index');
  };

  it('downloads only one when the language covers all the keys', async () => {
    const i18n = await freshI18n('fr,ja');
    await i18n.setLocale('fr');

    // English was not requested: it would have served as the fallback for no key.
    expect(i18n.coverage('en')).toBeNull();
    const keys = Object.keys(catalogOf('fr')).length;
    expect(i18n.coverage('fr')).toEqual({ translated: keys, total: keys });
    expect(i18n.t('common.save')).toBe(catalogOf('fr')['common.save']);
  });

  it('downloads two when the translation is partial, and the fallback holds', async () => {
    // `br` is out of the list: the build found it incomplete. The new module loads its own
    // catalogue instances: we truncate that one, not the one from the rest of the file.
    const i18n = await freshI18n('fr,ja');
    const partiel = (await import('./messages/br.json')).default as unknown as Record<string, unknown>;
    delete partiel['common.save'];
    await i18n.setLocale('br');

    expect(i18n.coverage('en')).not.toBeNull();
    expect(i18n.t('common.save')).toBe('Save');
    expect(i18n.t('common.close')).toBe(partiel['common.close']);
  });

  // Without build information (configuration without the computation), we do not know: we load
  // English. The fallback always takes precedence over the saving, never the reverse.
  it('downloads two when the build said nothing', async () => {
    const i18n = await freshI18n('');
    await i18n.loadCatalog('ja');
    expect(i18n.coverage('en')).not.toBeNull();
  });
});

// The notice shown on public surfaces (sign-in, client share) is not decorative: the GPL/AGPL
// requires "Appropriate Legal Notices" — copyright, licence, absence of warranty — which §13
// completes with the offer of the source code. A translation that lost them would put the
// instance out of compliance.
describe('AGPL §13 legal notice', () => {
  it.each(LOCALE_CODES)('porte copyright et licence en %s', (code) => {
    const notice = catalogOf(code)['license.notice'] as string;
    expect(notice).toContain('©');
    expect(notice).toContain('Yvig Bidon');
    expect(notice).toContain('AGPL-3.0');
    expect((catalogOf(code)['license.source'] as string).trim().length).toBeGreaterThan(0);
  });

  it('states the absence of warranty in English and in French', () => {
    expect(catalogOf('en')['license.notice']).toMatch(/no warranty/);
    expect(catalogOf('fr')['license.notice']).toMatch(/sans aucune garantie/);
  });
});
