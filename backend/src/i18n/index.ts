// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { BASE_LOCALE, LOCALE_CODES, isLocale, pluralTag, type Locale } from './locales';
import en from './messages/en.json';
import fr from './messages/fr.json';
import es from './messages/es.json';
import de from './messages/de.json';
import pt from './messages/pt.json';
import zhHans from './messages/zh-Hans.json';
import ko from './messages/ko.json';
import ja from './messages/ja.json';
import hi from './messages/hi.json';
import br from './messages/br.json';
import eu from './messages/eu.json';
import co from './messages/co.json';
import gswFR from './messages/gsw-FR.json';
import oc from './messages/oc.json';

export * from './locales';

/**
 * Traduction côté serveur — emails, notifications, messages destinés aux utilisateurs.
 *
 * Même contrat que le front (anglais de référence, repli en cascade, interpolation
 * `{name}`, pluriels CLDR), mais les catalogues sont chargés d'un bloc : ils pèsent
 * quelques dizaines de kilo-octets et le serveur sert plusieurs langues à la fois.
 *
 * Ces catalogues sont **indépendants** de ceux du front : le serveur n'a pas besoin des
 * libellés d'interface, et l'interface n'a pas besoin des gabarits d'email.
 */

type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };
type Message = string | PluralForms;
type Catalog = Partial<Record<MessageKey, Message>>;

/** L'ensemble des clés de traduction — dérivé du catalogue anglais de référence. */
export type MessageKey = keyof typeof en;

/** Valeurs interpolées dans un message ; `count` sélectionne la forme plurielle. */
export type TParams = Record<string, string | number> & { count?: number };

const CATALOGS: Record<Locale, Catalog> = {
  en: en,
  fr: fr,
  es: es,
  de: de,
  pt: pt,
  'zh-Hans': zhHans,
  ko: ko,
  ja: ja,
  hi: hi,
  br: br,
  eu: eu,
  co: co,
  'gsw-FR': gswFR,
  oc: oc,
};

const PLACEHOLDER = /\{(\w+)\}/g;

function interpolate(text: string, params: TParams | undefined): string {
  if (!params) return text;
  return text.replace(PLACEHOLDER, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

function selectPlural(forms: PluralForms, count: number, locale: Locale): string {
  try {
    return forms[new Intl.PluralRules(pluralTag(locale)).select(count)] ?? forms.other;
  } catch {
    return forms.other;
  }
}

/**
 * Traduit une clé dans la langue demandée, avec repli sur l'anglais clé par clé — une
 * traduction partielle donne donc un email lisible plutôt qu'un email troué.
 */
export function t(locale: Locale, key: MessageKey, params?: TParams): string {
  // Le typage ne protège pas d'une langue venue de la base (préférence enregistrée avant
  // qu'une langue soit retirée du registre) : un email dégradé vaut mieux qu'un envoi qui échoue.
  const own = CATALOGS[locale]?.[key];
  const message = own ?? CATALOGS[BASE_LOCALE][key];
  if (message === undefined) return key;
  if (typeof message === 'string') return interpolate(message, params);
  // Le pluriel suit la langue du message réellement retenu : un repli anglais s'accorde
  // en anglais, pas selon les règles de la langue demandée.
  const resolved = own === undefined ? BASE_LOCALE : locale;
  return interpolate(selectPlural(message, params?.count ?? 0, resolved), params);
}

/** Langue choisie par un compte dans ses préférences, si elle est connue du registre. */
export function localeFromPreferences(preferences: unknown): Locale | null {
  if (!preferences || typeof preferences !== 'object') return null;
  const value = (preferences as Record<string, unknown>).locale;
  return isLocale(value) ? value : null;
}

/**
 * Langue d'un lecteur **non authentifié**, négociée depuis `Accept-Language`.
 *
 * Les surfaces publiques du backend — au premier chef la page `/api/docs`, que l'AGPL §13
 * oblige à porter la mention de source — n'ont ni compte ni préférence enregistrée à
 * consulter. Faute de cette négociation, leur contenu était écrit en dur : la mention légale
 * de `/api/docs` s'affichait **en français** pour tout le monde, alors que la même mention
 * est rendue en anglais par le front. Une mention légale qui change de langue selon la porte
 * d'entrée n'est pas une mention légale.
 *
 * Les valeurs de qualité (`;q=`) sont respectées, et un tag régional retombe sur la langue :
 * `zh-CN` choisit `zh-Hans`, `pt-BR` choisit `pt`. Repli sur la langue de base.
 */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale {
  if (!header) return BASE_LOCALE;
  const ranked = header
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.find((p) => p.trim().startsWith('q='));
      const weight = q ? Number(q.trim().slice(2)) : 1;
      return { tag: tag.trim().toLowerCase(), weight: Number.isFinite(weight) ? weight : 0 };
    })
    .filter((r) => r.tag !== '' && r.tag !== '*' && r.weight > 0)
    // Tri stable : à qualité égale, l'ordre d'écriture fait foi, comme le veut la RFC.
    .sort((a, b) => b.weight - a.weight);
  for (const { tag } of ranked) {
    const exact = LOCALE_CODES.find((c) => c.toLowerCase() === tag);
    if (exact) return exact;
    const base = tag.split('-')[0] ?? tag;
    const loose = LOCALE_CODES.find(
      (c) => c.toLowerCase() === base || c.toLowerCase().startsWith(`${base}-`),
    );
    if (loose) return loose;
  }
  return BASE_LOCALE;
}
