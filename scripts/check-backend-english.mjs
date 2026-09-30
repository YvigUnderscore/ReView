// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Messages d'erreur du backend : anglais, et rien d'autre (D2).
 *
 * Ils étaient écrits en français — cent-soixante-quatorze occurrences dans soixante-dix
 * fichiers — et arrivaient tels quels à l'écran, y compris sur la page publique d'un
 * partage client. L'arbitrage est de les réécrire en anglais plutôt que de les traduire :
 * ce contrôle empêche le français de revenir par la porte du prochain correctif.
 *
 * Le repérage se fait sur les mots-outils du français, pas sur les accents : « Media
 * introuvable » n'en porte aucun et reste du français. À l'inverse « déjà » dans un
 * commentaire ne concerne personne — seuls les messages levés sont lus.
 *
 * Usage : node scripts/check-backend-english.mjs [--list]
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = 'backend/src';

/** Les fonctions dont le premier argument atterrit dans une réponse HTTP. */
const THROWING = /\b(badRequest|notFound|forbidden|conflict|unauthorized|tooManyRequests|new Error)\s*\(/;

/**
 * Mots qui ne laissent aucun doute : ils n'existent pas en anglais technique. Un seul
 * suffit à conclure.
 */
const FRENCH_STRONG =
  /\b(introuvable|invalide|réservé|réservée|impossible|déjà|aucun|aucune|inconnu|inconnue|échoué|échouée|volumineux|volumineuse|corbeille|séquence|tâche|fichier|attendu|attendue|requis|requise|vide|trop)\b/i;

/**
 * Mots-outils du français. Isolés, ils se rencontrent en anglais technique — « non-HTTP »,
 * « par » dans une URL — donc il en faut **deux distincts** pour conclure. Sans cette
 * règle, un message anglais parfaitement correct serait signalé.
 */
const FRENCH_WEAK =
  /\b(le|la|les|un|une|des|du|de|au|aux|ce|cet|cette|ces|est|sont|pas|non|pour|avec|sans|sur|dans|par|vers|votre|vos|ne|se|qui|que|encore|doit|doivent|peut|peuvent)\b/gi;

/** Ce que le message contient de toute façon : accents typiquement français. */
const FRENCH_LETTERS = /[àâäçéèêëîïôöùûüœ]/i;

/** Les littéraux passés à une fonction de levée, ligne par ligne. */
export function messagesOf(source) {
  const out = [];
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    if (!THROWING.test(line)) continue;
    // Le premier littéral de la ligne : c'est le message, le second est le code d'erreur.
    const literal = /['`]([^'`]{4,})['`]/.exec(line);
    if (literal) out.push({ line: index + 1, text: literal[1] });
  }
  return out;
}

/** Ce message est-il écrit en français ? */
export function looksFrench(text) {
  const weak = new Set((text.match(FRENCH_WEAK) ?? []).map((w) => w.toLowerCase()));
  return FRENCH_STRONG.test(text) || FRENCH_LETTERS.test(text) || weak.size >= 2;
}

/** Messages français d'un fichier — l'unité que le contrôle rapporte. */
export function offendersOf(source) {
  return messagesOf(source).filter((m) => looksFrench(m.text));
}

const GREEN = '[0;32m';
const RED = '[0;31m';
const OFF = '[0m';

function main() {
  const files = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith('.ts') && !full.endsWith('.test.ts')) files.push(full);
    }
  })(ROOT);

  const offenders = [];
  for (const file of files) {
    for (const found of offendersOf(readFileSync(file, 'utf8'))) {
      offenders.push({ file: relative('.', file), ...found });
    }
  }

  if (offenders.length === 0) {
    console.log(`${GREEN}✓ messages d'erreur backend : anglais${OFF}`);
    return;
  }

  if (process.argv.includes('--list')) {
    for (const o of offenders)
      console.log(`  ${o.file}:${o.line}
    ${o.text}`);
  }
  console.log(`${RED}✗ ${offenders.length} message(s) d'erreur en français dans ${ROOT}.${OFF}`);
  console.log('  Relancer avec --list pour les voir, puis les réécrire en anglais.');
  process.exitCode = 1;
}

// Importé par son test : on ne parcourt le dépôt que lorsqu'on est la commande lancée.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
