// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  LOCALE_STORAGE_KEY as BUILD_STORAGE_KEY,
  catalogChunkMap,
  i18nPreloadSnippet,
  injectPreloadScript,
  localesCoveringBaseCatalog,
} from '@/../vite.config.js';
import { BASE_LOCALE, LOCALE_CODES, LOCALE_STORAGE_KEY, isSharePath, negotiateLocale } from './index';

/**
 * Preloading of the language catalogue (F13).
 *
 * The script generated at build time replays the i18n core's negotiation outside TypeScript: these
 * tests keep the two in parity, otherwise the browser would preload one language and download
 * another — slower than before the fix.
 */

/** Table of code → file, as the plugin reads it from the bundle. */
const MAP = Object.fromEntries(LOCALE_CODES.map((c) => [c, `/assets/${c}-hash.js`]));

type FakeLink = { rel?: string; href?: string; crossOrigin?: string };

/**
 * Runs the preload script in a simulated environment and returns the links it sets.
 * The function's parameters shadow the globals: the script never reaches happy-dom's real DOM,
 * and a `localStorage` that throws can be simulated without touching the browser.
 */
function run(
  snippet: string,
  env: {
    stored?: string | null;
    storedThrows?: boolean;
    languages?: string[] | null;
    language?: string;
    /** Page path: a share link starts in English without negotiating. */
    pathname?: string;
  },
): FakeLink[] {
  const links: FakeLink[] = [];
  const document = {
    createElement: (): FakeLink => ({}),
    head: {
      appendChild: (l: FakeLink) => {
        links.push(l);
      },
    },
  };
  const navigator = { languages: env.languages ?? null, language: env.language ?? '' };
  const localStorage = {
    getItem: (key: string) => {
      if (env.storedThrows) throw new Error('stockage indisponible');
      return key === LOCALE_STORAGE_KEY ? (env.stored ?? null) : null;
    },
  };
  const location = { pathname: env.pathname ?? '/' };
  new Function('document', 'navigator', 'localStorage', 'location', snippet)(
    document,
    navigator,
    localStorage,
    location,
  );
  return links;
}

const snippetWith = (fullLocales: readonly string[]) =>
  i18nPreloadSnippet({
    map: MAP,
    fullLocales,
    codes: LOCALE_CODES,
    base: BASE_LOCALE,
    storageKey: BUILD_STORAGE_KEY,
  });

/** Snippet "all languages are complete": a single catalogue per load. */
const COMPLETE = snippetWith(LOCALE_CODES);

describe('storage key', () => {
  it('is the same at build time and at run time', () => {
    expect(BUILD_STORAGE_KEY).toBe(LOCALE_STORAGE_KEY);
  });
});

describe('catalogue chunk table', () => {
  const bundle = {
    'assets/index-a.js': {
      type: 'chunk',
      fileName: 'assets/index-a.js',
      moduleIds: ['/app/frontend/src/main.tsx'],
    },
    'assets/fr-b.js': {
      type: 'chunk',
      fileName: 'assets/fr-b.js',
      moduleIds: ['/app/frontend/src/v2/i18n/messages/fr.json'],
    },
    'assets/zh-Hans-c.js': {
      type: 'chunk',
      fileName: 'assets/zh-Hans-c.js',
      moduleIds: ['/app/frontend/src/v2/i18n/messages/zh-Hans.json?used'],
    },
    // Real bundle trap: Excalidraw ships its own locales, including `fr-FR`.
    'assets/fr-FR-XYZ-d.js': {
      type: 'chunk',
      fileName: 'assets/fr-FR-XYZ-d.js',
      moduleIds: ['/app/frontend/node_modules/@excalidraw/excalidraw/locales/fr-FR.json'],
    },
    'assets/index-e.css': { type: 'asset', fileName: 'assets/index-e.css' },
  };

  it('maps each catalogue to the file actually emitted', () => {
    expect(catalogChunkMap(bundle)).toEqual({
      fr: '/assets/fr-b.js',
      'zh-Hans': '/assets/zh-Hans-c.js',
    });
  });

  it("ignores the dependencies' locales and the assets", () => {
    expect(Object.values(catalogChunkMap(bundle))).not.toContain('/assets/fr-FR-XYZ-d.js');
  });

  it('prefixes the paths with the site base', () => {
    expect(catalogChunkMap(bundle, '/app/').fr).toBe('/app/assets/fr-b.js');
  });

  it('accepts module identifiers with Windows separators', () => {
    const win = {
      'assets/de-f.js': {
        type: 'chunk',
        fileName: 'assets/de-f.js',
        moduleIds: ['C:\\repo\\frontend\\src\\v2\\i18n\\messages\\de.json'],
      },
    };
    expect(catalogChunkMap(win)).toEqual({ de: '/assets/de-f.js' });
  });
});

describe('insertion into the document', () => {
  const html = '<html>\n  <head>\n    <title>ReView</title>\n  </head>\n  <body></body>\n</html>';

  const withEntry = html.replace(
    '</head>',
    '  <script type="module" crossorigin src="/assets/index-a.js"></script>\n  </head>',
  );

  it('sets a deferred script in the head', () => {
    expect(injectPreloadScript(html, '/assets/i18n-preload-x.js')).toContain(
      '<script defer src="/assets/i18n-preload-x.js"></script>',
    );
    expect(injectPreloadScript(html, '/assets/i18n-preload-x.js')).toMatch(/i18n-preload[\s\S]*<\/head>/);
  });

  /**
   * The only order that makes any difference: measured, a deferred script placed AFTER the entry
   * module only runs once that module has been downloaded and evaluated, and the catalogue
   * starts again at exactly the same moment as before the fix.
   */
  it('comes before the entry module', () => {
    const out = injectPreloadScript(withEntry, '/assets/i18n-preload-x.js');
    expect(out.indexOf('i18n-preload')).toBeLessThan(out.indexOf('type="module"'));
  });

  it('leaves the entry module as the only type="module" tag', () => {
    // `scripts/check-bundle-budget.mjs` takes the first `type="module"` tag as the entry: a module
    // placed here would make it measure this very script.
    const out = injectPreloadScript(withEntry, '/assets/i18n-preload-x.js');
    expect(out.match(/type="module"/g)).toHaveLength(1);
    expect(/<script[^>]+type="module"[^>]+src="([^"]+)"/.exec(out)?.[1]).toBe('/assets/index-a.js');
  });
});

describe('choice of the preloaded language', () => {
  it('follows the choice saved on the device', () => {
    // Deliberately a different tag from the saved value: storage wins.
    expect(run(COMPLETE, { stored: 'ja', languages: ['de-AT'] })).toEqual([
      { rel: 'modulepreload', crossOrigin: 'anonymous', href: '/assets/ja-hash.js' },
    ]);
  });

  it('ignores an unknown saved value and negotiates', () => {
    expect(run(COMPLETE, { stored: 'kl', languages: ['de'] })[0].href).toBe('/assets/de-hash.js');
  });

  it('survives a storage that throws (private mode)', () => {
    expect(run(COMPLETE, { storedThrows: true, languages: ['es-MX'] })[0].href).toBe('/assets/es-hash.js');
  });

  it('falls back to navigator.language when languages is absent', () => {
    expect(run(COMPLETE, { languages: null, language: 'pt-BR' })[0].href).toBe('/assets/pt-hash.js');
  });

  it('preloads the base language when nothing matches', () => {
    expect(run(COMPLETE, { languages: ['kl-GL', 'tlh'] })[0].href).toBe(`/assets/${BASE_LOCALE}-hash.js`);
  });

  /**
   * Parity with `negotiateLocale()`: the build script and the i18n core must choose the same
   * code for any preference, otherwise the preload would be wasted.
   */
  it.each([
    ['fr'],
    ['fr-CA'],
    ['FR-ca'],
    ['zh'],
    ['zh-CN'],
    ['zh-TW'],
    ['zh-Hans-CN'],
    ['gsw-FR'],
    ['gsw'],
    ['GSW-fr'],
    ['oc-FR'],
    ['pt-BR'],
    ['ko-KR'],
    ['hi-IN'],
    ['br-FR'],
    ['eu-ES'],
    ['co'],
    ['en-GB'],
    ['kl-GL'],
    ['  '],
  ])('précharge le même catalogue que negotiateLocale pour %s', (tag) => {
    const expected = negotiateLocale([tag]);
    expect(run(COMPLETE, { languages: [tag] })[0].href).toBe(`/assets/${expected}-hash.js`);
  });

  it('walks the preferences in order, as the core does', () => {
    const prefs = ['tlh', 'kl-GL', 'ja-JP', 'fr'];
    expect(run(COMPLETE, { languages: prefs })[0].href).toBe(`/assets/${negotiateLocale(prefs)}-hash.js`);
  });
});

describe('fallback chain', () => {
  it('adds English when the language does not cover all the base keys', () => {
    const partial = snippetWith(LOCALE_CODES.filter((c) => c !== 'fr'));
    expect(run(partial, { stored: 'fr' }).map((l) => l.href)).toEqual([
      '/assets/fr-hash.js',
      `/assets/${BASE_LOCALE}-hash.js`,
    ]);
  });

  it('adds nothing when the language covers all the keys', () => {
    expect(run(COMPLETE, { stored: 'fr' })).toHaveLength(1);
  });

  it('does not preload twice for the base language', () => {
    const partial = snippetWith([]);
    expect(run(partial, { stored: BASE_LOCALE })).toHaveLength(1);
  });

  it('preloads exactly what loadCatalog will fetch from the real bundle', () => {
    // `localesCoveringBaseCatalog()` feeds both `import.meta.env.I18N_FULL_LOCALES`
    // (read by `loadCatalog`) and the preload script: the list must come from the same source.
    const full = localesCoveringBaseCatalog();
    const snippet = snippetWith(full);
    for (const code of LOCALE_CODES) {
      const expected = code === BASE_LOCALE || full.includes(code) ? 1 : 2;
      expect(run(snippet, { stored: code }), code).toHaveLength(expected);
    }
  });
});

/**
 * The client portal starts in English without negotiating (`isSharePath`). The preload script must
 * apply the SAME rule: if it preloaded French from the browser while the bundle asked for English,
 * the reader would pay for two catalogues and wait for the second — exactly what preloading exists
 * to avoid.
 */
describe('share link — English up front, on both sides', () => {
  // `fr-CA` rather than the metropolitan variant: the `no-restricted-syntax` rule bans that
  // literal to catch frozen dates, and negotiation is the same.
  const FR = ['fr-CA', 'fr'];

  it('preloads the base language on a share link, whatever the browser', () => {
    expect(run(COMPLETE, { pathname: '/client/abc123', languages: FR })).toEqual([
      { rel: 'modulepreload', crossOrigin: 'anonymous', href: MAP[BASE_LOCALE] },
    ]);
  });

  it('negotiates normally everywhere else in the application', () => {
    expect(run(COMPLETE, { pathname: '/projects/7', languages: FR })).toEqual([
      { rel: 'modulepreload', crossOrigin: 'anonymous', href: MAP.fr },
    ]);
  });

  // The reader's explicit choice wins: it is the last one made with full knowledge.
  it('respects a saved choice, even on a share link', () => {
    expect(run(COMPLETE, { pathname: '/client/abc123', stored: 'fr', languages: ['en'] })).toEqual([
      { rel: 'modulepreload', crossOrigin: 'anonymous', href: MAP.fr },
    ]);
  });

  // Parity is the point: the build rule and the core rule classify the same way.
  it('classifies the same paths as the i18n core', () => {
    for (const pathname of ['/client/abc', '/review/client/abc', '/projects/7', '/', '/clients']) {
      const preloadedBase = run(COMPLETE, { pathname, languages: FR })[0]?.href === MAP[BASE_LOCALE];
      expect(preloadedBase).toBe(isSharePath(pathname));
    }
  });
});
