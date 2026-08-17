// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Vérifie les catalogues de traduction de ReView.
 *
 * Une traduction partielle est légitime — les clés manquantes retombent sur l'anglais —
 * mais une traduction *incohérente* casse l'écran : placeholder disparu, forme plurielle
 * absente, terme métier traduit, clé qui ne correspond plus à rien. Ce script attrape
 * ces cas-là et laisse passer l'incomplétude, qu'il se contente de chiffrer.
 *
 * Usage : node scripts/check-translations.mjs [--json]
 */

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Jeux de catalogues du dépôt : même registre de langues, clés indépendantes. */
export const CATALOG_SETS = [
  { name: 'frontend', dir: 'frontend/src/v2/i18n' },
  { name: 'backend', dir: 'backend/src/i18n' },
];

export const CLDR_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'];

/** Noms des variables interpolées dans un message (`{name}`). */
export function placeholders(text) {
  return new Set(Array.from(text.matchAll(/\{(\w+)\}/g), (m) => m[1]));
}

/** Ramène un message (chaîne simple ou formes plurielles) à une table de formes. */
export function normalizeMessage(value) {
  return typeof value === 'string' ? { other: value } : { ...value };
}

/**
 * Première étiquette candidate réellement connue d'`Intl` — miroir exact de la
 * résolution du runtime front. Sans ce filtre, `new Intl.PluralRules('co')` retombe
 * silencieusement sur la locale par défaut et le script validerait les mauvaises formes.
 */
export function resolveIntlTag(candidates, fallback = 'en') {
  for (const tag of candidates) {
    try {
      if (Intl.PluralRules.supportedLocalesOf([tag]).length > 0) return tag;
    } catch {
      /* étiquette mal formée : candidate suivante */
    }
  }
  return fallback;
}

/** Catégories de pluriel que la langue distingue réellement (repli : `other` seul). */
export function supportedCategories(tag) {
  try {
    return new Intl.PluralRules(tag).resolvedOptions().pluralCategories;
  } catch {
    return ['other'];
  }
}

/**
 * Termes du glossaire présents dans un message. La correspondance porte sur un début
 * de mot : « boards » compte pour « board », « ReViewera » pour « ReView ».
 */
export function glossaryHits(text, terms) {
  return terms.filter((term) =>
    new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}`, 'i').test(text),
  );
}

/** Compare deux registres de langues, en ignorant les clés de commentaire. */
export function sameRegistry(a, b) {
  const strip = (o) => JSON.stringify(o, (k, v) => (k === '$comment' ? undefined : v));
  return strip(a) === strip(b);
}

/**
 * Confronte un catalogue traduit au catalogue de référence.
 * Renvoie les erreurs bloquantes, les remarques non bloquantes et le nombre de clés traduites.
 */
export function checkCatalog({ base, target, locale, categories, terms }) {
  const errors = [];
  const warnings = [];
  let translated = 0;

  for (const key of Object.keys(target)) {
    if (key.startsWith('$')) continue;
    if (!(key in base)) {
      errors.push(`${locale}: clé « ${key} » absente du catalogue de référence`);
    }
  }

  for (const [key, baseValue] of Object.entries(base)) {
    if (key.startsWith('$')) continue;
    const targetValue = target[key];
    if (targetValue === undefined) continue; // repli anglais : légitime
    translated += 1;

    const baseForms = normalizeMessage(baseValue);
    const targetForms = normalizeMessage(targetValue);
    const expected = new Set(Object.values(baseForms).flatMap((v) => Array.from(placeholders(v))));

    if (typeof baseValue === 'object' && typeof targetValue === 'string') {
      errors.push(`${locale}: « ${key} » attend des formes plurielles, pas une chaîne simple`);
      continue;
    }
    if (targetForms.other === undefined) {
      errors.push(`${locale}: « ${key} » n'a pas de forme « other » (obligatoire, c'est le repli)`);
    }

    for (const [category, text] of Object.entries(targetForms)) {
      if (!CLDR_CATEGORIES.includes(category)) {
        errors.push(`${locale}: « ${key} » utilise la forme inconnue « ${category} »`);
        continue;
      }
      if (!categories.includes(category)) {
        errors.push(
          `${locale}: « ${key} » définit « ${category} », que cette langue ne distingue pas (formes utiles : ${categories.join(', ')})`,
        );
      }
      if (!text.trim()) {
        errors.push(`${locale}: « ${key} » (${category}) est vide`);
        continue;
      }

      const got = placeholders(text);
      for (const name of expected) {
        if (!got.has(name)) errors.push(`${locale}: « ${key} » (${category}) perd la variable {${name}}`);
      }
      for (const name of got) {
        if (!expected.has(name))
          errors.push(`${locale}: « ${key} » (${category}) invente la variable {${name}}`);
      }

      for (const term of glossaryHits(Object.values(baseForms).join(' '), terms)) {
        if (!glossaryHits(text, [term]).length) {
          errors.push(
            `${locale}: « ${key} » (${category}) traduit le terme métier « ${term} » — il doit rester tel quel`,
          );
        }
      }
    }

    // Seuls les messages comptés ont des formes plurielles à couvrir : une phrase
    // ordinaire n'a que « other », ce n'est pas une lacune.
    if (typeof baseValue === 'object') {
      for (const category of categories) {
        if (category !== 'other' && targetForms[category] === undefined) {
          warnings.push(`${locale}: « ${key} » n'a pas de forme « ${category} » (repli sur « other »)`);
        }
      }
    }
  }

  return { errors, warnings, translated };
}

/** Codes déclarés dans l'union TypeScript `Locale` de locales.ts. */
export function localeUnionCodes(source) {
  const block = source.match(/export type Locale =([\s\S]*?);/);
  if (!block) return null;
  return Array.from(block[1].matchAll(/'([^']+)'/g), (m) => m[1]);
}

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));

async function checkSet(set, glossary, reference) {
  const dir = path.join(repoRoot, set.dir);
  const registry = await readJson(path.join(dir, 'locales.json'));
  const errors = [];
  const warnings = [];
  const report = [];

  if (reference && !sameRegistry(reference.registry, registry)) {
    errors.push(
      `${set.name}: locales.json diffère de ${reference.name}/locales.json — les deux paquets doivent proposer les mêmes langues`,
    );
  }

  const unionPath = path.join(dir, 'locales.ts');
  if (existsSync(unionPath)) {
    const codes = localeUnionCodes(await readFile(unionPath, 'utf8'));
    const declared = registry.locales.map((l) => l.code);
    if (!codes) errors.push(`${set.name}: union « Locale » introuvable dans locales.ts`);
    else if (codes.join('|') !== declared.join('|')) {
      errors.push(
        `${set.name}: l'union Locale (${codes.join(', ')}) ne correspond pas à locales.json (${declared.join(', ')})`,
      );
    }
  }

  const messagesDir = path.join(dir, 'messages');
  const files = (await readdir(messagesDir)).filter((f) => f.endsWith('.json'));
  const declared = new Set(registry.locales.map((l) => l.code));
  for (const file of files) {
    const code = file.replace(/\.json$/, '');
    if (!declared.has(code))
      errors.push(`${set.name}: messages/${file} ne correspond à aucune langue du registre`);
  }

  const base = await readJson(path.join(messagesDir, `${registry.base}.json`));
  const total = Object.keys(base).filter((k) => !k.startsWith('$')).length;

  for (const locale of registry.locales) {
    const file = path.join(messagesDir, `${locale.code}.json`);
    if (!existsSync(file)) {
      errors.push(
        `${set.name}: la langue « ${locale.code} » est déclarée mais messages/${locale.code}.json manque`,
      );
      continue;
    }
    if (locale.code === registry.base) {
      report.push({ code: locale.code, translated: total, total });
      continue;
    }
    const result = checkCatalog({
      base,
      target: await readJson(file),
      locale: `${set.name}/${locale.code}`,
      categories: supportedCategories(resolveIntlTag(locale.intl.plural)),
      terms: glossary.terms,
    });
    errors.push(...result.errors);
    warnings.push(...result.warnings);
    report.push({ code: locale.code, translated: result.translated, total });
  }

  return { errors, warnings, report, registry };
}

async function main() {
  const glossary = await readJson(path.join(repoRoot, 'scripts/i18n-glossary.json'));
  const errors = [];
  const warnings = [];
  let reference = null;

  for (const set of CATALOG_SETS) {
    if (!existsSync(path.join(repoRoot, set.dir, 'locales.json'))) continue;
    const result = await checkSet(set, glossary, reference);
    reference ??= { name: set.name, registry: result.registry };
    errors.push(...result.errors);
    warnings.push(...result.warnings);

    const lines = result.report.map(({ code, translated, total }) => {
      const pct = total ? Math.round((translated / total) * 100) : 100;
      return `    ${code.padEnd(8)} ${String(pct).padStart(3)}%  (${translated}/${total})`;
    });
    console.log(`  ${set.name} — couverture :\n${lines.join('\n')}`);
  }

  if (warnings.length) {
    console.log(`  ${warnings.length} remarque(s) non bloquante(s) :`);
    for (const w of warnings.slice(0, 10)) console.log(`    ${w}`);
    if (warnings.length > 10) console.log(`    … et ${warnings.length - 10} de plus`);
  }

  if (errors.length) {
    console.error(`[0;31m✗ ${errors.length} problème(s) de traduction :[0m`);
    for (const e of errors) console.error(`  ${e}`);
    console.error('  → voir DOCUMENTATION/development/i18n.md');
    process.exit(1);
  }
  console.log('✓ catalogues de traduction cohérents');
}

// Exécuté directement (et non importé par un test) → on lance.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
