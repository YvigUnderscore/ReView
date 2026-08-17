// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useSyncExternalStore } from 'react';
import base from './messages/en.json';
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
 * reste utilisable. Seul l'anglais est embarqué dans le bundle ; les autres catalogues
 * sont chargés à la demande, une langue supplémentaire ne coûte donc rien aux autres.
 *
 * Le vocabulaire métier (shot, sequence, dailies, playblast, version, annotation…) n'est
 * jamais traduit : les artistes le lisent en anglais dans tous les pipelines. Voir le
 * glossaire dans `scripts/check-translations.mjs` et DOCUMENTATION/development/i18n.md.
 */

/** Formes plurielles d'un message, nommées d'après les catégories CLDR. */
type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };
type Message = string | PluralForms;
type Catalog = Partial<Record<MessageKey, Message>>;

/** L'ensemble des clés de traduction — dérivé du catalogue anglais de référence. */
export type MessageKey = keyof typeof base;

/** Signature du traducteur — à passer aux helpers définis hors composant. */
export type Tr = typeof t;

/** Valeurs interpolées dans un message : `{name}` dans le catalogue. */
export type TParams = Record<string, string | number> & { count?: number };

const STORAGE_KEY = 'locale';

/** Catalogues chargés, l'anglais étant toujours présent. */
const catalogs = new Map<Locale, Catalog>([[BASE_LOCALE, base]]);

/**
 * Chargeurs paresseux, un par fichier de `messages/`. Le glob est résolu à la
 * compilation : déposer un nouveau `<code>.json` suffit à le rendre chargeable.
 */
const loaders = import.meta.glob<{ default: Catalog }>('./messages/*.json');

function loaderFor(code: Locale): (() => Promise<{ default: Catalog }>) | undefined {
  return loaders[`./messages/${code}.json`];
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

/** Charge le catalogue d'une langue s'il manque (l'anglais est déjà là). */
export async function loadCatalog(code: Locale): Promise<void> {
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
  const total = Object.keys(base).length;
  if (code === BASE_LOCALE) return { translated: total, total };
  const catalog = catalogs.get(code);
  if (!catalog) return null;
  const translated = Object.keys(base).filter((k) => catalog[k as MessageKey] !== undefined).length;
  return { translated, total };
}
