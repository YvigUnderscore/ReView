// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import registry from './locales.json';

/**
 * Registre des langues — vue typée de `locales.json` (copie identique côté backend).
 *
 * Ajouter une langue : une entrée dans `locales.json`, le code dans l'union `Locale`,
 * un `messages/<code>.json`. `scripts/check-translations.mjs` refuse tout écart entre
 * ces trois sources et entre les registres front/back.
 */
export type Locale =
  'en' | 'fr' | 'es' | 'de' | 'pt' | 'zh-Hans' | 'ko' | 'ja' | 'hi' | 'br' | 'eu' | 'co' | 'gsw-FR' | 'oc';

/** Métadonnées d'affichage et de formatage d'une langue. */
export type LocaleInfo = {
  /** Étiquette BCP-47 : identifiant, clé de fichier et attribut `lang` du document. */
  code: Locale;
  /** Endonyme — la langue s'annonce dans sa propre langue dans le sélecteur. */
  native: string;
  /** Exonyme anglais, pour la doc et l'admin. */
  english: string;
  dir: 'ltr' | 'rtl';
  /** Langue régionale : signalée comme telle dans le sélecteur (ReView les défend). */
  regional: boolean;
  /** Catalogue produit par traduction automatique, non relu par un humain. */
  machineTranslated: boolean;
  /**
   * Étiquettes candidates pour les API `Intl`, de la plus précise à la plus sûre : toutes
   * les langues du registre ne sont pas dans ICU (corse, alsacien), et les règles de
   * pluriel ne suivent pas toujours les conventions de chiffres (le corse pluralise
   * comme l'italien mais s'écrit avec les formats français).
   */
  intl: { plural: string[]; format: string[] };
};

/** Langue de référence : elle définit l'ensemble des clés et sert de repli universel. */
export const BASE_LOCALE: Locale = registry.base as Locale;

export const LOCALES = registry.locales as readonly LocaleInfo[];

export const LOCALE_CODES: readonly Locale[] = LOCALES.map((l) => l.code);

const BY_CODE = new Map<string, LocaleInfo>(LOCALES.map((l) => [l.code, l]));

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && BY_CODE.has(value);
}

/** Métadonnées d'une langue (repli sur la langue de base si le code est inconnu). */
export function localeInfo(code: Locale): LocaleInfo {
  return BY_CODE.get(code) ?? BY_CODE.get(BASE_LOCALE)!;
}

/**
 * Choisit la première étiquette réellement connue d'`Intl` parmi les candidates.
 * Sans ce filtre, `Intl.PluralRules('co')` retombe silencieusement sur la racine et
 * range tous les nombres dans `other` — les singuliers disparaîtraient.
 */
function firstSupported(
  api: { supportedLocalesOf(tags: string[]): string[] },
  candidates: readonly string[],
): string {
  for (const tag of candidates) {
    try {
      if (api.supportedLocalesOf([tag]).length > 0) return tag;
    } catch {
      /* étiquette mal formée : on passe à la candidate suivante */
    }
  }
  return BASE_LOCALE;
}

/** Étiquette à passer à `Intl.PluralRules` pour cette langue. */
export function pluralTag(code: Locale): string {
  return firstSupported(Intl.PluralRules, localeInfo(code).intl.plural);
}

/** Étiquette à passer aux formateurs de nombres, dates et listes. */
export function formatTag(code: Locale): string {
  return firstSupported(Intl.NumberFormat, localeInfo(code).intl.format);
}

/**
 * Négocie la meilleure langue disponible à partir des préférences du navigateur.
 * `fr-CA` retient `fr`, `zh-CN` retient `zh-Hans` ; sinon repli sur la langue de base.
 */
export function negotiateLocale(preferred: readonly string[]): Locale {
  for (const raw of preferred) {
    const tag = raw.trim();
    if (!tag) continue;
    if (isLocale(tag)) return tag;

    const lower = tag.toLowerCase();
    const exact = LOCALE_CODES.find((c) => c.toLowerCase() === lower);
    if (exact) return exact;

    // `zh`, `zh-CN`, `zh-SG` → chinois simplifié ; `zh-TW`/`zh-Hant` ne sont pas encore
    // proposés et retombent volontairement sur la langue de base.
    if (lower === 'zh' || lower.startsWith('zh-hans') || /^zh-(cn|sg|my)$/.test(lower)) {
      return 'zh-Hans';
    }

    const primary = lower.split('-')[0];
    const byPrimary = LOCALE_CODES.find((c) => c.toLowerCase().split('-')[0] === primary);
    if (byPrimary) return byPrimary;
  }
  return BASE_LOCALE;
}
