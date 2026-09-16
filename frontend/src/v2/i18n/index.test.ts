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

/** Tous les catalogues, chargés d'un bloc pour les vérifications transverses. */
const catalogs = import.meta.glob<{ default: Record<string, unknown> }>('./messages/*.json', {
  eager: true,
});
const catalogOf = (code: Locale) => catalogs[`./messages/${code}.json`].default;

describe('registre des langues', () => {
  it('a l’anglais pour langue de base', () => {
    expect(BASE_LOCALE).toBe('en');
  });

  it('déclare les quatorze langues attendues', () => {
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

  it('fournit un catalogue par langue déclarée', () => {
    for (const code of LOCALE_CODES) expect(catalogs[`./messages/${code}.json`]).toBeDefined();
  });

  it('ne signale que l’anglais comme non issu d’une machine', () => {
    const authored = LOCALES.filter((l) => !l.machineTranslated).map((l) => l.code);
    expect(authored).toEqual(['en']);
  });

  it('classe les cinq langues régionales', () => {
    expect(LOCALES.filter((l) => l.regional).map((l) => l.code)).toEqual(['br', 'eu', 'co', 'gsw-FR', 'oc']);
  });

  it('annonce chaque langue dans sa propre langue', () => {
    for (const l of LOCALES) expect(l.native.trim().length).toBeGreaterThan(0);
    expect(localeInfo('ja').native).toBe('日本語');
  });

  it('reconnaît les codes du registre et rejette les autres', () => {
    expect(isLocale('gsw-FR')).toBe(true);
    expect(isLocale('kl')).toBe(false);
    expect(isLocale(null)).toBe(false);
  });
});

describe('résolution des étiquettes Intl', () => {
  it('retient une étiquette réellement connue d’Intl pour chaque langue', () => {
    for (const code of LOCALE_CODES) {
      expect(Intl.PluralRules.supportedLocalesOf([pluralTag(code)]).length).toBeGreaterThan(0);
      expect(Intl.NumberFormat.supportedLocalesOf([formatTag(code)]).length).toBeGreaterThan(0);
    }
  });

  it('pluralise le corse comme l’italien, pas comme la racine', () => {
    expect(new Intl.PluralRules(pluralTag('co')).select(1)).toBe('one');
  });

  it('donne aux langues régionales leurs propres formats quand ICU les connaît', () => {
    // CLDR porte les noms de mois bretons (« Eost ») et occitans (« d'agost ») : les
    // écraser par `fr` aurait affiché un mois français au milieu d'une phrase bretonne.
    expect(formatTag('br')).toBe('br');
    expect(formatTag('oc')).toBe('oc');
  });

  it('replie sur le français les langues régionales absentes d’ICU', () => {
    // `co` n'a pas de données ICU ; `gsw` en a, mais suisses (séparateur ’, ordre AAAA
    // MMM JJ) — la Corse et l'Alsace lisent des dates françaises.
    expect(formatTag('co')).toBe('fr');
    expect(formatTag('gsw-FR')).toBe('fr');
  });

  it('laisse le basque à ses propres conventions', () => {
    expect(formatTag('eu')).toBe('eu');
  });
});

describe('négociation depuis le navigateur', () => {
  it('retient une correspondance exacte', () => {
    expect(negotiateLocale(['fr'])).toBe('fr');
  });

  it('ramène une variante régionale à sa langue', () => {
    expect(negotiateLocale(['fr-CA'])).toBe('fr');
    expect(negotiateLocale(['pt-BR'])).toBe('pt');
  });

  it('ramène le chinois de Chine continentale au simplifié', () => {
    expect(negotiateLocale(['zh-CN'])).toBe('zh-Hans');
    expect(negotiateLocale(['zh'])).toBe('zh-Hans');
  });

  it('suit l’ordre de préférence du navigateur', () => {
    expect(negotiateLocale(['kl', 'eu', 'fr'])).toBe('eu');
  });

  it('retombe sur l’anglais sans correspondance', () => {
    expect(negotiateLocale(['kl-GL'])).toBe('en');
    expect(negotiateLocale([])).toBe('en');
  });
});

describe('traduction', () => {
  beforeEach(async () => {
    localStorage.clear();
    await setLocale('en');
  });

  it('démarre en anglais', () => {
    expect(getLocale()).toBe('en');
    expect(t('login.submit')).toBe('Sign in');
  });

  it('bascule de langue et persiste le choix', async () => {
    await setLocale('ja');
    expect(getLocale()).toBe('ja');
    expect(t('login.submit')).toBe('ログイン');
    expect(localStorage.getItem('locale')).toBe('ja');
  });

  it('ignore une langue absente du registre', async () => {
    await setLocale('eu');
    await setLocale('kl' as Locale);
    expect(getLocale()).toBe('eu');
  });

  it('retombe sur l’anglais quand la clé n’est pas traduite', async () => {
    await setLocale('br');
    // Catalogue tronqué : la clé disparaît, le repli anglais doit prendre le relais.
    const catalog = catalogOf('br') as Record<string, string>;
    const saved = catalog['common.save'];
    delete catalog['common.save'];
    expect(t('common.save')).toBe('Save');
    catalog['common.save'] = saved!;
  });

  it('rend la clé elle-même si elle n’existe nulle part', () => {
    expect(t('nope.nope' as never)).toBe('nope.nope');
  });

  /**
   * Une clé construite (`error.${code}` pour un code d'erreur d'API) peut ne rien
   * désigner : l'appelant doit pouvoir le savoir avant d'afficher la clé à l'écran.
   */
  it('dit si une clé construite existe au catalogue', () => {
    expect(hasMessage('common.save')).toBe(true);
    expect(hasMessage('error.CODE_QUI_N_EXISTE_PAS')).toBe(false);
    expect(hasMessage('')).toBe(false);
  });

  it('interpole les variables', async () => {
    await setLocale('fr');
    expect(t('language.coverage', { count: 12, translated: 12, total: 67 })).toBe(
      '12 phrases traduites sur 67',
    );
  });

  it('laisse la variable en place quand elle n’est pas fournie', () => {
    expect(t('language.coverage', { count: 2 })).toContain('{translated}');
  });

  it('accorde le pluriel selon la langue', async () => {
    await setLocale('en');
    expect(t('language.coverage', { count: 1, translated: 1, total: 67 })).toBe('1 of 67 phrase translated');
    expect(t('language.coverage', { count: 2, translated: 2, total: 67 })).toBe('2 of 67 phrases translated');
    // Le français range zéro au singulier, l'anglais au pluriel.
    await setLocale('fr');
    expect(t('language.coverage', { count: 0, translated: 0, total: 67 })).toBe('0 phrase traduite sur 67');
  });

  it('sert une forme unique aux langues sans pluriel', async () => {
    await setLocale('ja');
    expect(t('language.coverage', { count: 1, translated: 1, total: 67 })).toBe('67 件中 1 件を翻訳済み');
    expect(t('language.coverage', { count: 5, translated: 5, total: 67 })).toBe('67 件中 5 件を翻訳済み');
  });

  it('chiffre la couverture d’un catalogue chargé', async () => {
    await loadCatalog('oc');
    const stats = coverage('oc');
    expect(stats).not.toBeNull();
    expect(stats!.translated).toBe(stats!.total);
  });

  // Régression : le snapshot était la langue elle-même. À l'arrivée du catalogue elle
  // valait déjà sa nouvelle valeur, React court-circuitait le rendu et l'écran restait
  // figé sur le repli anglais — visible en bascule vers une langue jamais chargée.
  it('change de snapshot à chaque notification, catalogue compris', async () => {
    await setLocale('en');
    const seen: number[] = [];
    const unsubscribe = subscribeToLocale(() => seen.push(localeSnapshot()));
    await setLocale('co');
    unsubscribe();
    expect(seen.length).toBe(2); // bascule immédiate, puis arrivée du catalogue
    expect(new Set(seen).size).toBe(2); // deux snapshots distincts, sinon pas de rendu
    expect(t('common.save')).toBe('Arregistrà');
  });

  it('aligne l’attribut lang du document sur la langue', async () => {
    await setLocale('zh-Hans');
    expect(document.documentElement.lang).toBe('zh-Hans');
    expect(document.documentElement.dir).toBe('ltr');
  });
});

/**
 * Ce que le navigateur télécharge avant le premier écran (F1).
 *
 * Mesure au build, sur le même arbre, `vite build` deux fois : avec l'anglais inliné
 * 310,2 ko gzip de premier chargement (chunk d'entrée 176,2) ; sans, 258,6 ko (chunk
 * d'entrée 124,7) — **51,5 ko gzip, 16,6 %**, plus un chunk `en-*.js` de 51,0 ko que
 * seules les langues incomplètes vont chercher. Les tests qui suivent gardent les deux
 * conditions de cette économie : aucun catalogue dans le chunk d'entrée, et une liste
 * de langues complètes qui dit vrai — sans quoi une traduction partielle afficherait
 * des clés brutes à la place du repli anglais.
 */
describe('poids du premier chargement', () => {
  // `process.cwd()` est la racine du projet frontend, celle que vitest se donne.
  const source = readFileSync(path.join(process.cwd(), 'src/v2/i18n/index.ts'), 'utf8');

  it('n’importe statiquement aucun catalogue : ils arrivent tous par leur chunk', () => {
    const inlines = [...source.matchAll(/^import\s[^\n]*?from\s+'\.\/messages\/[^']+'/gm)];
    expect(inlines.map((m) => m[0])).toEqual([]);
  });

  it('laisse les quatorze catalogues chargeables à la demande', async () => {
    for (const code of LOCALE_CODES) {
      await loadCatalog(code);
      expect(coverage(code), code).not.toBeNull();
    }
  });

  /**
   * La liste est calculée par `vite.config.js` en lisant les fichiers ; le bundle, lui,
   * sert les modules vus par Vite. Les deux vues doivent coïncider : une langue déclarée
   * complète à tort n'irait plus chercher l'anglais, et ses clés manquantes s'afficheraient
   * telles quelles.
   */
  it('ne déclare complète qu’une langue qui couvre vraiment toutes les clés', () => {
    const baseKeys = Object.keys(catalogOf(BASE_LOCALE));
    const reallyComplete = LOCALE_CODES.filter(
      (code) => code !== BASE_LOCALE && baseKeys.every((k) => catalogOf(code)[k] !== undefined),
    );
    expect([...localesCoveringBaseCatalog()].sort()).toEqual([...reallyComplete].sort());
  });
});

/**
 * Le socle embarque le catalogue de base **hors production** — sans quoi les tests, qui
 * n'amorcent pas l'application, n'auraient aucun message à traduire. Les cas qui suivent
 * rejouent donc les conditions de production (`PROD` vrai, aucun catalogue en mémoire) sur
 * une instance neuve du module, et comptent ce qui est réellement téléchargé : un
 * catalogue, ou deux. `coverage(code)` vaut `null` tant qu'un catalogue n'est pas arrivé —
 * c'est notre compteur de requêtes.
 */
describe('en conditions de production : nombre de catalogues téléchargés', () => {
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

  it('n’en télécharge qu’un quand la langue couvre toutes les clés', async () => {
    const i18n = await freshI18n('fr,ja');
    await i18n.setLocale('fr');

    // L'anglais n'a pas été demandé : il n'aurait servi de repli à aucune clé.
    expect(i18n.coverage('en')).toBeNull();
    const keys = Object.keys(catalogOf('fr')).length;
    expect(i18n.coverage('fr')).toEqual({ translated: keys, total: keys });
    expect(i18n.t('common.save')).toBe(catalogOf('fr')['common.save']);
  });

  it('en télécharge deux quand la traduction est partielle, et le repli tient', async () => {
    // `br` hors de la liste : le build l'a trouvée incomplète. Le module neuf charge ses
    // propres instances de catalogue : on tronque celle-là, pas celle du reste du fichier.
    const i18n = await freshI18n('fr,ja');
    const partiel = (await import('./messages/br.json')).default as unknown as Record<string, unknown>;
    delete partiel['common.save'];
    await i18n.setLocale('br');

    expect(i18n.coverage('en')).not.toBeNull();
    expect(i18n.t('common.save')).toBe('Save');
    expect(i18n.t('common.close')).toBe(partiel['common.close']);
  });

  // Sans information de build (configuration sans le calcul), on ne sait pas : on charge
  // l'anglais. Le repli prime sur l'économie, jamais l'inverse.
  it('en télécharge deux quand le build n’a rien dit', async () => {
    const i18n = await freshI18n('');
    await i18n.loadCatalog('ja');
    expect(i18n.coverage('en')).not.toBeNull();
  });
});

// La mention affichée sur les surfaces publiques (connexion, partage client) n'est pas
// décorative : la GPL/AGPL exige des « Appropriate Legal Notices » — copyright, licence,
// absence de garantie — que le §13 complète par l'offre du code source. Une traduction
// qui les perdrait ferait tomber l'instance hors conformité.
describe('mention légale AGPL §13', () => {
  it.each(LOCALE_CODES)('porte copyright et licence en %s', (code) => {
    const notice = catalogOf(code)['license.notice'] as string;
    expect(notice).toContain('©');
    expect(notice).toContain('Yvig Bidon');
    expect(notice).toContain('AGPL-3.0');
    expect((catalogOf(code)['license.source'] as string).trim().length).toBeGreaterThan(0);
  });

  it('énonce l’absence de garantie en anglais et en français', () => {
    expect(catalogOf('en')['license.notice']).toMatch(/no warranty/);
    expect(catalogOf('fr')['license.notice']).toMatch(/sans aucune garantie/);
  });
});
