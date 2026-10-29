// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useSyncExternalStore } from 'react';
import {
  BASE_LOCALE,
  formatTag,
  isLocale,
  isSharePath,
  localeInfo,
  negotiateLocale,
  pluralTag,
  type Locale,
} from './locales';

export * from './locales';

/**
 * ReView i18n core — no dependencies.
 *
 * English is the base language: `messages/en.json` defines the full set of keys, and any key
 * missing from another catalogue falls back to it, so a partial translation stays usable.
 *
 * **No catalogue is embedded in the entry chunk**, not even English: it weighed 51.5 kB gzip —
 * 16.6% of the first load measured at build time — which every non-English reader paid before
 * downloading their own language, only to never read a sentence of it. The fourteen catalogues
 * are now separate chunks, and English is only loaded if it really serves as a fallback, that is
 * when the chosen language does not cover all the base keys (see `coversAllBaseKeys`).
 *
 * Business vocabulary (shot, sequence, dailies, playblast, version, annotation…) is never
 * translated: artists read it in English in every pipeline. See the glossary in
 * `scripts/check-translations.mjs` and DOCUMENTATION/development/i18n.md.
 */

/** Plural forms of a message, named after the CLDR categories. */
type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };
type Message = string | PluralForms;
type Catalog = Partial<Record<MessageKey, Message>>;

/**
 * The set of translation keys — derived from the reference English catalogue.
 *
 * `typeof import(…)` is a type, not a value: TypeScript resolves it at compile time and nothing
 * remains in the bundle. An ordinary `import`, by contrast, inlined the 3,197 keys into the
 * entry chunk.
 */
export type MessageKey = keyof typeof import('./messages/en.json');

/** Signature of the translator — to pass to helpers defined outside the component. */
export type Tr = typeof t;

/** Values interpolated into a message: `{name}` in the catalogue. */
export type TParams = Record<string, string | number> & { count?: number };

/**
 * `localStorage` key where the language chosen on this device lives.
 *
 * This module is no longer the only one reading it: the preload script generated at build time
 * (`i18nCatalogPreload` in `vite.config.js`, fix F13) must open the same key to know which
 * catalogue to preload before the bundle even runs. Hence the export — `preload.test.ts` checks
 * both values against each other: a divergence would silently preload one language and download
 * another.
 */
export const LOCALE_STORAGE_KEY = 'locale';

/** Loaded catalogues. Empty at startup: even English arrives through its own chunk. */
const catalogs = new Map<Locale, Catalog>();

/**
 * Lazy loaders, one per file in `messages/`. The glob is resolved at
 * compile time: dropping in a new `<code>.json` is enough to make it loadable.
 */
const loaders = import.meta.glob<{ default: Catalog }>('./messages/*.json');

/**
 * Outside production, the base catalogue is embedded straight away: unit tests call `t()` and
 * `hasMessage()` without going through the `initLocale()` bootstrap, and the development server
 * has no chunk to save anyway. `import.meta.env.PROD` is resolved at compile time: the branch — and
 * with it the catalogue — disappears from the shipped bundle (checked on the build: no English key
 * remains in the entry chunk).
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
 * Does this language cover all the keys of the base catalogue? If so, English would serve no
 * purpose as a fallback and is not downloaded — that is the whole saving.
 *
 * The list is computed at build time by `vite.config.js`, from the very files that go into the
 * bundle: it cannot lie about what is shipped. When absent (dev, tests, configuration without the
 * plugin), we do not know: English is loaded. The fallback always takes precedence over the saving.
 */
function coversAllBaseKeys(code: Locale): boolean {
  if (code === BASE_LOCALE) return true;
  const declared: unknown = import.meta.env.I18N_FULL_LOCALES;
  return typeof declared === 'string' && declared.split(',').includes(code);
}

let current: Locale = BASE_LOCALE;
const listeners = new Set<() => void>();

/**
 * Store revision counter, and not the current language, because `useSyncExternalStore` short-circuits
 * rendering when the snapshot does not change: when the catalogue arrives, the language already holds
 * its new value, and the screen would stay frozen on the English fallback.
 */
let version = 0;

function emit(): void {
  version += 1;
  listeners.forEach((fn) => fn());
}

const getVersion = () => version;

function readStored(): Locale | null {
  try {
    const v = localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(v) ? v : null;
  } catch {
    return null; // storage unavailable (SSR, tests, private mode)
  }
}

/** Loads a catalogue if it is missing, without ever failing the caller. */
async function fetchCatalog(code: Locale): Promise<void> {
  if (catalogs.has(code)) return;
  const load = loaderFor(code);
  if (!load) return; // language declared without a catalogue: it will stay in English
  try {
    const mod = await load();
    catalogs.set(code, mod.default);
  } catch {
    /* unreadable catalogue: the English fallback takes over */
  }
}

/**
 * Loads the catalogue of a language, together with the base language's one when it will serve
 * as the fallback. Both requests go out **in parallel**: the fallback chain is complete at first
 * render, in a single round trip rather than two.
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

/** True when the language comes from an explicit choice saved on this device. */
export function hasExplicitLocale(): boolean {
  return readStored() !== null;
}

/**
 * Changes the current language. The render switches immediately (English fallback for the keys
 * of the catalogue not yet arrived), then a second time when loading completes.
 */
export function setLocale(code: Locale, options: { persist?: boolean } = {}): Promise<void> {
  if (!isLocale(code)) return Promise.resolve();
  const { persist = true } = options;
  if (persist) {
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, code);
    } catch {
      /* storage unavailable */
    }
  }
  if (code === current && catalogs.has(code)) return Promise.resolve();
  current = code;
  applyDocumentLocale(code);
  emit();
  return loadCatalog(code).then(emit);
}

/** What the browser reports, when we are allowed to listen to it. */
const negotiateBrowserLocale = (): Locale =>
  negotiateLocale(typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language]));

/**
 * Determines and loads the starting language: the choice saved on the device, otherwise —
 * **except on a share link, which starts in English** (see `isSharePath`) — negotiation with
 * the browser preferences. Called before the first render to avoid a visible flash of English.
 *
 * `pathname` is a parameter rather than a direct read of `location`: that is what makes the
 * rule testable without simulating navigation.
 */
export function initLocale(pathname?: string): Promise<void> {
  const path = pathname ?? (typeof location === 'undefined' ? '' : location.pathname);
  const preferred = readStored() ?? (isSharePath(path) ? BASE_LOCALE : negotiateBrowserLocale());
  current = preferred;
  applyDocumentLocale(preferred);
  return loadCatalog(preferred).then(emit);
}

/**
 * Aligns the language with the account preference, unless an explicit choice has already been
 * made on this device — that choice wins, it is the one made last with full knowledge.
 */
export function syncAccountLocale(code: string | null | undefined): void {
  if (!isLocale(code) || hasExplicitLocale()) return;
  void setLocale(code, { persist: false });
}

function lookup(code: Locale, key: MessageKey): Message | undefined {
  return catalogs.get(code)?.[key];
}

/** Picks the plural form matching `count` in the current language. */
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
 * Translates a key in the current language.
 *
 * Cascading fallback: current catalogue → English. A key missing everywhere returns the key
 * itself, which makes it visible in review rather than emptying the screen.
 */
export function t(key: MessageKey, params?: TParams): string {
  const message = lookup(current, key) ?? lookup(BASE_LOCALE, key);
  if (message === undefined) return key;

  if (typeof message === 'string') return interpolate(message, params);

  const count = params?.count ?? 0;
  // Plural resolution uses the language of the message actually chosen: an English message
  // served as a fallback follows English rules, not those of the current language.
  const resolved = lookup(current, key) === undefined ? BASE_LOCALE : current;
  return interpolate(selectPlural(message, count, resolved), params);
}

/**
 * Does the key exist in the catalogue? Useful for **constructed** keys — `error.${code}` for an
 * API error code — where the caller must be able to fall back on something other than the key
 * itself displayed on screen.
 */
export function hasMessage(key: string): key is MessageKey {
  // The union "current language ∪ English" gives back exactly the set of base keys: no catalogue
  // has an orphan key (`check-translations.mjs` refuses them), and English is loaded as soon as
  // the current language does not cover everything.
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

/** Reactive `t`: the component re-renders on language change and when the catalogue arrives. */
export function useT(): typeof t {
  useSyncExternalStore(subscribe, getVersion, () => 0);
  return t;
}

/**
 * Label to pass to the `Intl` APIs for the current language — dates and numbers follow the
 * reader's choice instead of being frozen to one locale.
 */
export function intlLocale(): string {
  return formatTag(current);
}

/** Current language, reactive. */
export function useLocale(): Locale {
  useSyncExternalStore(subscribe, getVersion, () => 0);
  return current;
}

/**
 * Contract of the store, exported so it can be tested: `t()` alone does not reveal whether React
 * has what it needs to re-render — the pair of subscription and snapshot is what decides.
 */
export { subscribe as subscribeToLocale, getVersion as localeSnapshot };

/**
 * Share of the keys actually translated in a language — feeds the coverage note of the selector.
 * Returns `null` until the catalogue is loaded.
 */
export function coverage(code: Locale): { translated: number; total: number } | null {
  const catalog = catalogs.get(code);
  if (!catalog) return null;
  const baseCatalog = catalogs.get(BASE_LOCALE);
  // No base catalogue in memory ⇒ this one covers all its keys: that is precisely the condition
  // under which we gave up downloading English.
  if (!baseCatalog) {
    const complete = Object.keys(catalog).length;
    return { translated: complete, total: complete };
  }
  const total = Object.keys(baseCatalog).length;
  if (code === BASE_LOCALE) return { translated: total, total };
  const translated = Object.keys(baseCatalog).filter((k) => catalog[k as MessageKey] !== undefined).length;
  return { translated, total };
}
