// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  LOCALE_STORAGE_KEY as BUILD_STORAGE_KEY,
  catalogChunkMap,
  i18nPreloadSnippet,
  injectPreloadScript,
  localesCoveringBaseCatalog,
} from '../../../vite.config.js';
import { BASE_LOCALE, LOCALE_CODES, LOCALE_STORAGE_KEY, negotiateLocale } from './index';

/**
 * Préchargement du catalogue de langue (F13).
 *
 * Le script produit au build rejoue la négociation du socle i18n hors de TypeScript : ces
 * tests tiennent la parité entre les deux, faute de quoi le navigateur préchargerait une
 * langue et en téléchargerait une autre — plus lent qu'avant le correctif.
 */

/** Table code → fichier, comme le plugin la relève sur le bundle. */
const MAP = Object.fromEntries(LOCALE_CODES.map((c) => [c, `/assets/${c}-hash.js`]));

type FakeLink = { rel?: string; href?: string; crossOrigin?: string };

/**
 * Exécute le script de préchargement dans un environnement simulé et rend les liens posés.
 * Les paramètres de la fonction masquent les globales : le script n'atteint jamais le DOM
 * réel de happy-dom, et un `localStorage` qui lève se simule sans toucher au navigateur.
 */
function run(
  snippet: string,
  env: { stored?: string | null; storedThrows?: boolean; languages?: string[] | null; language?: string },
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
  new Function('document', 'navigator', 'localStorage', snippet)(document, navigator, localStorage);
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

/** Snippet « toutes les langues sont complètes » : un seul catalogue par chargement. */
const COMPLETE = snippetWith(LOCALE_CODES);

describe('clé de stockage', () => {
  it('est la même au build et à l’exécution', () => {
    expect(BUILD_STORAGE_KEY).toBe(LOCALE_STORAGE_KEY);
  });
});

describe('table des chunks de catalogue', () => {
  const bundle = {
    'assets/index-a.js': {
      type: 'chunk',
      fileName: 'assets/index-a.js',
      moduleIds: ['/app/frontend/src/main.jsx'],
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
    // Piège réel du bundle : Excalidraw livre ses propres locales, dont `fr-FR`.
    'assets/fr-FR-XYZ-d.js': {
      type: 'chunk',
      fileName: 'assets/fr-FR-XYZ-d.js',
      moduleIds: ['/app/frontend/node_modules/@excalidraw/excalidraw/locales/fr-FR.json'],
    },
    'assets/index-e.css': { type: 'asset', fileName: 'assets/index-e.css' },
  };

  it('associe chaque catalogue au fichier réellement émis', () => {
    expect(catalogChunkMap(bundle)).toEqual({
      fr: '/assets/fr-b.js',
      'zh-Hans': '/assets/zh-Hans-c.js',
    });
  });

  it('ignore les locales des dépendances et les assets', () => {
    expect(Object.values(catalogChunkMap(bundle))).not.toContain('/assets/fr-FR-XYZ-d.js');
  });

  it('préfixe les chemins par la base du site', () => {
    expect(catalogChunkMap(bundle, '/app/').fr).toBe('/app/assets/fr-b.js');
  });

  it('accepte les identifiants de module à séparateurs Windows', () => {
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

describe('insertion dans le document', () => {
  const html = '<html>\n  <head>\n    <title>ReView</title>\n  </head>\n  <body></body>\n</html>';

  const withEntry = html.replace(
    '</head>',
    '  <script type="module" crossorigin src="/assets/index-a.js"></script>\n  </head>',
  );

  it('pose un script différé dans l’en-tête', () => {
    expect(injectPreloadScript(html, '/assets/i18n-preload-x.js')).toContain(
      '<script defer src="/assets/i18n-preload-x.js"></script>',
    );
    expect(injectPreloadScript(html, '/assets/i18n-preload-x.js')).toMatch(/i18n-preload[\s\S]*<\/head>/);
  });

  /**
   * Le seul ordre qui fasse gagner quoi que ce soit : mesuré, un script différé placé
   * APRÈS le module d'entrée n'est exécuté qu'une fois ce module téléchargé et évalué, et
   * le catalogue repart exactement au même instant qu'avant le correctif.
   */
  it('précède le module d’entrée', () => {
    const out = injectPreloadScript(withEntry, '/assets/i18n-preload-x.js');
    expect(out.indexOf('i18n-preload')).toBeLessThan(out.indexOf('type="module"'));
  });

  it('laisse le module d’entrée seul porteur de type="module"', () => {
    // `scripts/check-bundle-budget.mjs` prend la première balise `type="module"` pour
    // l'entrée : un module posé ici lui ferait mesurer ce script-ci.
    const out = injectPreloadScript(withEntry, '/assets/i18n-preload-x.js');
    expect(out.match(/type="module"/g)).toHaveLength(1);
    expect(/<script[^>]+type="module"[^>]+src="([^"]+)"/.exec(out)?.[1]).toBe('/assets/index-a.js');
  });
});

describe('choix de la langue préchargée', () => {
  it('suit le choix enregistré sur l’appareil', () => {
    // Tag volontairement différent de la valeur enregistrée : c'est le stockage qui gagne.
    expect(run(COMPLETE, { stored: 'ja', languages: ['de-AT'] })).toEqual([
      { rel: 'modulepreload', crossOrigin: 'anonymous', href: '/assets/ja-hash.js' },
    ]);
  });

  it('ignore une valeur enregistrée inconnue et négocie', () => {
    expect(run(COMPLETE, { stored: 'kl', languages: ['de'] })[0].href).toBe('/assets/de-hash.js');
  });

  it('survit à un stockage qui lève (mode privé)', () => {
    expect(run(COMPLETE, { storedThrows: true, languages: ['es-MX'] })[0].href).toBe('/assets/es-hash.js');
  });

  it('retombe sur navigator.language quand languages est absent', () => {
    expect(run(COMPLETE, { languages: null, language: 'pt-BR' })[0].href).toBe('/assets/pt-hash.js');
  });

  it('précharge la langue de base quand rien ne correspond', () => {
    expect(run(COMPLETE, { languages: ['kl-GL', 'tlh'] })[0].href).toBe(`/assets/${BASE_LOCALE}-hash.js`);
  });

  /**
   * Parité avec `negotiateLocale()` : le script du build et le socle i18n doivent choisir
   * le même code pour toute préférence, sans quoi la précharge serait perdue.
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

  it('parcourt les préférences dans l’ordre, comme le socle', () => {
    const prefs = ['tlh', 'kl-GL', 'ja-JP', 'fr'];
    expect(run(COMPLETE, { languages: prefs })[0].href).toBe(`/assets/${negotiateLocale(prefs)}-hash.js`);
  });
});

describe('chaîne de repli', () => {
  it('ajoute l’anglais quand la langue ne couvre pas toutes les clés de base', () => {
    const partial = snippetWith(LOCALE_CODES.filter((c) => c !== 'fr'));
    expect(run(partial, { stored: 'fr' }).map((l) => l.href)).toEqual([
      '/assets/fr-hash.js',
      `/assets/${BASE_LOCALE}-hash.js`,
    ]);
  });

  it('n’ajoute rien quand la langue couvre toutes les clés', () => {
    expect(run(COMPLETE, { stored: 'fr' })).toHaveLength(1);
  });

  it('ne précharge pas deux fois pour la langue de base', () => {
    const partial = snippetWith([]);
    expect(run(partial, { stored: BASE_LOCALE })).toHaveLength(1);
  });

  it('précharge exactement ce que loadCatalog ira chercher sur le bundle réel', () => {
    // `localesCoveringBaseCatalog()` alimente à la fois `import.meta.env.I18N_FULL_LOCALES`
    // (lu par `loadCatalog`) et le script de précharge : la liste doit être la même source.
    const full = localesCoveringBaseCatalog();
    const snippet = snippetWith(full);
    for (const code of LOCALE_CODES) {
      const expected = code === BASE_LOCALE || full.includes(code) ? 1 : 2;
      expect(run(snippet, { stored: code }), code).toHaveLength(expected);
    }
  });
});
