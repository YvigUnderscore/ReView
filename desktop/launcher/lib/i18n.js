// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Traductions du lanceur : les quatorze langues de l'application web, même langue de base
 * (l'anglais définit les clés, toute autre langue y retombe clé par clé), même négociation
 * avec les langues du système (`frontend/src/v2/i18n/locales.ts`, `negotiateLocale`).
 * Un test vérifie que la liste ci-dessous suit le registre de l'application.
 */

export const AVAILABLE = [
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
];
export const BASE = 'en';

/**
 * Première langue du système que le lanceur sait parler : code exact (`gsw-FR`), chinois
 * simplifié pour `zh`, `zh-CN`, `zh-SG`, `zh-MY`, puis sous-étiquette primaire (`fr-CA` → `fr`).
 */
export function pickLanguage(languages, available = AVAILABLE) {
  for (const raw of languages ?? []) {
    const lower = String(raw).trim().toLowerCase();
    if (!lower) continue;
    const exact = available.find((c) => c.toLowerCase() === lower);
    if (exact) return exact;
    if (
      available.includes('zh-Hans') &&
      (lower === 'zh' || lower.startsWith('zh-hans') || /^zh-(cn|sg|my)$/.test(lower))
    ) {
      return 'zh-Hans';
    }
    const primary = lower.split('-')[0];
    const byPrimary = available.find((c) => c.toLowerCase().split('-')[0] === primary);
    if (byPrimary) return byPrimary;
  }
  return BASE;
}

/** `t('connect.checking', { host })` : clé traduite, sinon anglaise, sinon la clé brute. */
export function createT(catalog, fallback) {
  return (key, vars = {}) => {
    const text = catalog[key] ?? fallback[key] ?? key;
    return text.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
  };
}

export async function loadI18n(languages, fetchJson) {
  const lang = pickLanguage(languages);
  const fallback = await fetchJson(`i18n/${BASE}.json`);
  const catalog = lang === BASE ? fallback : await fetchJson(`i18n/${lang}.json`);
  return { lang, t: createT(catalog, fallback) };
}
