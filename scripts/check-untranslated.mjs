// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Détecte les chaînes françaises encore écrites en dur dans le frontend.
 *
 * Pourquoi ce script existe : une première version ne regardait que du texte JSX tenant sur
 * une seule ligne, sans accolade. Tous les paragraphes que Prettier coupe sur plusieurs
 * lignes lui échappaient, et la migration i18n a été annoncée « terminée » alors qu'il
 * restait des centaines de chaînes. Ici on retire les commentaires, puis on relève **tout**
 * texte JSX (multi-ligne compris) et **tout** littéral de chaîne avant de garder ce qui
 * ressemble à du français.
 *
 * Le compte est comparé à un plafond (`CEILING`) : la suite échoue s'il remonte. Baisser le
 * plafond quand on descend, jamais l'inverse.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = 'frontend/src/v2';

/**
 * Plafond de chaînes françaises tolérées. Les 18 restantes sont des faux positifs
 * structurels : piles de polices CSS, classes `--active`, identifiants `active`, et
 * fragments de code que la détection par littéral confond avec de la prose.
 */
const CEILING = 18;

// Accents typiques, ou mots-outils français qui n'existent pas tels quels en anglais.
const FRENCH =
  /[éèêëàâçùûôîïœÉÈÊÀÇÔÎÛ]|[dlnsjcmt]['’](?=[a-zA-ZàâéèêîôûA-Z])|\b(le|la|les|un|une|des|du|au|aux|et|ou|pour|avec|sans|dans|sur|par|qui|que|quoi|ce|cette|ces|vos|votre|vous|nos|notre|aucun|aucune|tous|toutes|plus|est|sont|sera|seront|depuis|vers|hors|ligne|niveau|leur|leurs|puis|ici|elles|ils|son|ses|si|mais|comme|entre|chaque|tout|toute|peut|peuvent|doit|doivent|fait|faire|voir|selon|actives|actifs|active|nouveau|nouvelle|nouveaux|nouvelles|dernier|dernière|derniers|dernières|premier|première|ajouter|créer|créez|supprimer|modifier|enregistrer|afficher|masquer|partages|réglages|statistiques|calendrier|bonjour|tâches|tâche|activer|désactiver|choisir|choisissez|sélectionner|rechercher|fermer|ouvrir|copier|coller|déconnecter|appareil|utilisé|utilisée|utilisés|illimité|défaut|aperçu|invité|jamais)\b/i;

// Ce qui ressemble à du français mais n'en est pas : identifiants, chemins, formats.
const SKIP = /^(https?:|\/|\.|#|[A-Z_]+$|[a-z]+([A-Z][a-z]*)+$)|^\s*$/;

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/[^\n]*/g, ' ');

function* candidates(src) {
  // Texte JSX, multi-ligne compris : entre `>` et `<`, sans accolade ni balise.
  for (const m of src.matchAll(/>([^<>{}]+)</g)) yield m[1].split(/\s+/).join(' ').trim();
  // Littéraux de chaîne, y compris les gabarits sans interpolation.
  for (const m of src.matchAll(/'((?:[^'\\\n]|\\.)+)'|"((?:[^"\\\n]|\\.)+)"|`([^`${}]+)`/g))
    yield (m[1] ?? m[2] ?? m[3]).split(/\s+/).join(' ').trim();
}

function* sources(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== 'i18n') yield* sources(full);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      yield full;
    }
  }
}

const findings = new Map();
for (const file of sources(ROOT)) {
  const src = stripComments(readFileSync(file, 'utf8'));
  for (const text of candidates(src)) {
    if (text.length < 3 || SKIP.test(text) || !FRENCH.test(text)) continue;
    const list = findings.get(file) ?? [];
    if (!list.includes(text)) list.push(text);
    findings.set(file, list);
  }
}

const total = [...findings.values()].reduce((n, v) => n + v.length, 0);
const verbose = process.argv.includes('--list');
if (verbose) {
  for (const [file, items] of [...findings].sort()) {
    console.log(relative(ROOT, file).split(sep).join('/'));
    for (const item of items) console.log('   ', item);
  }
}

if (total > CEILING) {
  console.error(
    `\x1b[0;31m✗ ${total} chaîne(s) française(s) en dur dans ${ROOT} (plafond : ${CEILING}).\x1b[0m`,
  );
  console.error('  Relancer avec --list pour les voir, puis les passer par t().');
  process.exit(1);
}
console.log(`\x1b[0;32m✓ chaînes françaises en dur : ${total} (plafond ${CEILING})\x1b[0m`);
