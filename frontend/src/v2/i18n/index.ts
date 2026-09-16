// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useSyncExternalStore } from 'react';
import {
  BASE_LOCALE,
  formatTag,
  isLocale,
  localeInfo,
  negotiateLocale,
  pluralTag,
  type Locale,
} from './locales';

export * from './locales';

/**
 * Socle i18n de ReView — sans dépendance.
 *
 * L'anglais est la langue de base : `messages/en.json` définit l'ensemble des clés et
 * toute clé absente d'un autre catalogue y retombe, si bien qu'une traduction partielle
 * reste utilisable.
 *
 * **Aucun catalogue n'est embarqué dans le chunk d'entrée**, pas même l'anglais : il y
 * pesait 51,5 ko gzip — 16,6 % du premier chargement mesuré au build — que tout lecteur
 * non anglophone payait avant de télécharger sa propre langue, pour n'en lire jamais une
 * phrase. Les quatorze catalogues sont désormais des chunks à part, et l'anglais n'est
 * chargé que s'il sert effectivement de repli, c'est-à-dire quand la langue retenue ne
 * couvre pas toutes les clés de base (voir `coversAllBaseKeys`).
 *
 * Le vocabulaire métier (shot, sequence, dailies, playblast, version, annotation…) n'est
 * jamais traduit : les artistes le lisent en anglais dans tous les pipelines. Voir le
 * glossaire dans `scripts/check-translations.mjs` et DOCUMENTATION/development/i18n.md.
 */

/** Formes plurielles d'un message, nommées d'après les catégories CLDR. */
type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };
type Message = string | PluralForms;
type Catalog = Partial<Record<MessageKey, Message>>;

/**
 * L'ensemble des clés de traduction — dérivé du catalogue anglais de référence.
 *
 * `typeof import(…)` est un type, pas une valeur : TypeScript le résout à la compilation
 * et il ne subsiste rien au bundle. Un `import` ordinaire, lui, inlinait les 3 197 clés
 * dans le chunk d'entrée.
 */
export type MessageKey = keyof typeof import('./messages/en.json');

/** Signature du traducteur — à passer aux helpers définis hors composant. */
export type Tr = typeof t;

/** Valeurs interpolées dans un message : `{name}` dans le catalogue. */
export type TParams = Record<string, string | number> & { count?: number };

const STORAGE_KEY = 'locale';

/** Catalogues chargés. Vide au démarrage : même l'anglais arrive par son propre chunk. */
const catalogs = new Map<Locale, Catalog>();

/**
 * Chargeurs paresseux, un par fichier de `messages/`. Le glob est résolu à la
 * compilation : déposer un nouveau `<code>.json` suffit à le rendre chargeable.
 */
const loaders = import.meta.glob<{ default: Catalog }>('./messages/*.json');

/**
 * Hors production, le catalogue de base est embarqué d'emblée : les tests unitaires
 * appellent `t()` et `hasMessage()` sans passer par l'amorçage `initLocale()`, et le
 * serveur de développement n'a de toute façon pas de chunk à économiser. `import.meta.env.PROD`
 * est résolu à la compilation : la branche — et avec elle le catalogue — disparaît du
 * bundle livré (vérifié sur le build : plus aucune clé anglaise dans le chunk d'entrée).
 */
if (!import.meta.env.PROD) {
  const embedded = import.meta.glob<{ default: Catalog }>('./messages/en.json', { eager: true });
  const baseModule = embedded['./messages/en.json'];
  if (baseModule) catalogs.set(BASE_LOCALE, baseModule.default);
}

function loaderFor(code: Locale): (() => Promise<{ default: Catalog }>) | undefined {
  return loaders[`./messages/${code}.json`];
}

/**
 * Cette langue couvre-t-elle toutes les clés du catalogue de base ? Si oui, l'anglais ne
 * lui servirait de repli à rien et on ne le télécharge pas — c'est là toute l'économie.
 *
 * La liste est calculée au build par `vite.config.js`, sur les fichiers-mêmes qui partent
 * dans le bundle : elle ne peut pas mentir sur ce qui est livré. Absente (dev, tests,
 * configuration sans le plugin), on ne sait pas : on charge l'anglais. Le repli prime
 * toujours sur l'économie.
 */
function coversAllBaseKeys(code: Locale): boolean {
  if (code === BASE_LOCALE) return true;
  const declared: unknown = import.meta.env.I18N_FULL_LOCALES;
  return typeof declared === 'string' && declared.split(',').includes(code);
}

let current: Locale = BASE_LOCALE;
const listeners = new Set<() => void>();

/**
 * Compteur de révision du store, et non la langue courante, parce que `useSyncExternalStore`
 * court-circuite le rendu quand le snapshot ne change pas : à l'arrivée du catalogue la
 * langue vaut déjà sa nouvelle valeur, et l'écran resterait figé sur le repli anglais.
 */
let version = 0;

function emit(): void {
  version += 1;
  listeners.forEach((fn) => fn());
}

const getVersion = () => version;

function readStored(): Locale | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isLocale(v) ? v : null;
  } catch {
    return null; // stockage indisponible (SSR, tests, mode privé)
  }
}

/** Charge un catalogue s'il manque, sans jamais faire échouer l'appelant. */
async function fetchCatalog(code: Locale): Promise<void> {
  if (catalogs.has(code)) return;
  const load = loaderFor(code);
  if (!load) return; // langue déclarée sans catalogue : elle restera en anglais
  try {
    const mod = await load();
    catalogs.set(code, mod.default);
  } catch {
    /* catalogue illisible : le repli anglais prend le relais */
  }
}

/**
 * Charge le catalogue d'une langue, accompagné de celui de la langue de base lorsqu'il
 * lui servira de repli. Les deux requêtes partent **en parallèle** : la chaîne de repli
 * est complète au premier rendu, en un seul aller-retour et non deux.
 */
export async function loadCatalog(code: Locale): Promise<void> {
  await Promise.all(
    coversAllBaseKeys(code) ? [fetchCatalog(code)] : [fetchCatalog(code), fetchCatalog(BASE_LOCALE)],
  );
}

function applyDocumentLocale(code: Locale): void {
  if (typeof document === 'undefined') return;
  const info = localeInfo(code);
  document.documentElement.lang = code;
  document.documentElement.dir = info.dir;
}

export function getLocale(): Locale {
  return current;
}

/** Vrai quand la langue vient d'un choix explicite enregistré sur cet appareil. */
export function hasExplicitLocale(): boolean {
  return readStored() !== null;
}

/**
 * Change la langue courante. Le rendu bascule immédiatement (repli anglais pour les
 * clés du catalogue pas encore arrivé), puis une seconde fois à la fin du chargement.
 */
export function setLocale(code: Locale, options: { persist?: boolean } = {}): Promise<void> {
  if (!isLocale(code)) return Promise.resolve();
  const { persist = true } = options;
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch {
      /* stockage indisponible */
    }
  }
  if (code === current && catalogs.has(code)) return Promise.resolve();
  current = code;
  applyDocumentLocale(code);
  emit();
  return loadCatalog(code).then(emit);
}

/**
 * Détermine et charge la langue de démarrage : choix enregistré sur l'appareil, sinon
 * négociation avec les préférences du navigateur. Appelé avant le premier rendu pour
 * éviter un passage visible par l'anglais.
 */
export function initLocale(): Promise<void> {
  const preferred =
    readStored() ??
    negotiateLocale(typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language]));
  current = preferred;
  applyDocumentLocale(preferred);
  return loadCatalog(preferred).then(emit);
}

/**
 * Aligne la langue sur la préférence du compte, sauf si un choix explicite a déjà été
 * fait sur cet appareil — ce choix-là l'emporte, c'est celui qui a été posé en dernier
 * en connaissance de cause.
 */
export function syncAccountLocale(code: string | null | undefined): void {
  if (!isLocale(code) || hasExplicitLocale()) return;
  void setLocale(code, { persist: false });
}

function lookup(code: Locale, key: MessageKey): Message | undefined {
  return catalogs.get(code)?.[key];
}

/** Choisit la forme plurielle correspondant à `count` dans la langue courante. */
function selectPlural(forms: PluralForms, count: number, code: Locale): string {
  try {
    const rule = new Intl.PluralRules(pluralTag(code)).select(count);
    return forms[rule] ?? forms.other;
  } catch {
    return forms.other;
  }
}

const PLACEHOLDER = /\{(\w+)\}/g;

function interpolate(text: string, params: TParams | undefined): string {
  if (!params) return text;
  return text.replace(PLACEHOLDER, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/**
 * Traduit une clé dans la langue courante.
 *
 * Repli en cascade : catalogue courant → anglais. Une clé absente partout renvoie la
 * clé elle-même, ce qui la rend visible en revue plutôt que de vider l'écran.
 */
export function t(key: MessageKey, params?: TParams): string {
  const message = lookup(current, key) ?? lookup(BASE_LOCALE, key);
  if (message === undefined) return key;

  if (typeof message === 'string') return interpolate(message, params);

  const count = params?.count ?? 0;
  // Le pluriel se résout dans la langue du message réellement retenu : un message
  // anglais servi en repli suit les règles anglaises, pas celles de la langue courante.
  const resolved = lookup(current, key) === undefined ? BASE_LOCALE : current;
  return interpolate(selectPlural(message, count, resolved), params);
}

/**
 * La clé existe-t-elle au catalogue ? Utile aux clés **construites** — `error.${code}`
 * pour un code d'erreur d'API — où l'appelant doit pouvoir se rabattre sur autre chose
 * que la clé elle-même affichée à l'écran.
 */
export function hasMessage(key: string): key is MessageKey {
  // L'union « langue courante ∪ anglais » redonne exactement l'ensemble des clés de base :
  // aucun catalogue n'a de clé orpheline (`check-translations.mjs` les refuse), et l'anglais
  // est chargé dès que la langue courante ne couvre pas tout.
  return declaresKey(current, key) || declaresKey(BASE_LOCALE, key);
}

function declaresKey(code: Locale, key: string): boolean {
  const catalog = catalogs.get(code);
  return catalog !== undefined && Object.hasOwn(catalog, key);
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

/** `t` réactif : le composant se re-rend au changement de langue et à l'arrivée du catalogue. */
export function useT(): typeof t {
  useSyncExternalStore(subscribe, getVersion, () => 0);
  return t;
}

/**
 * Étiquette à passer aux API `Intl` pour la langue courante — les dates et les
 * nombres suivent le choix du lecteur au lieu d'être figés sur une locale.
 */
export function intlLocale(): string {
  return formatTag(current);
}

/** Langue courante, réactive. */
export function useLocale(): Locale {
  useSyncExternalStore(subscribe, getVersion, () => 0);
  return current;
}

/**
 * Contrat du store, exporté pour être testable : `t()` seul ne révèle pas si React a
 * bien de quoi re-rendre — c'est le couple abonnement + snapshot qui le décide.
 */
export { subscribe as subscribeToLocale, getVersion as localeSnapshot };

/**
 * Part des clés effectivement traduites dans une langue — alimente la mention de
 * couverture du sélecteur. Renvoie `null` tant que le catalogue n'est pas chargé.
 */
export function coverage(code: Locale): { translated: number; total: number } | null {
  const catalog = catalogs.get(code);
  if (!catalog) return null;
  const baseCatalog = catalogs.get(BASE_LOCALE);
  // Pas de catalogue de base en mémoire ⇒ celui-ci couvre toutes ses clés : c'est
  // précisément la condition à laquelle on a renoncé à télécharger l'anglais.
  if (!baseCatalog) {
    const complete = Object.keys(catalog).length;
    return { translated: complete, total: complete };
  }
  const total = Object.keys(baseCatalog).length;
  if (code === BASE_LOCALE) return { translated: total, total };
  const translated = Object.keys(baseCatalog).filter((k) => catalog[k as MessageKey] !== undefined).length;
  return { translated, total };
}
