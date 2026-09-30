// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Détecte les **clés de traduction que plus personne ne cite** — l'inverse de
 * `check-raw-keys.mjs` (clé affichée telle quelle) et de `check-untranslated.mjs` (texte
 * jamais passé par `t()`).
 *
 * Une clé morte ne casse rien : elle coûte. Chacune est écrite quatorze fois, et une
 * langue de plus, c'est quatorze traductions de plus à produire, à relire et à maintenir
 * pour du texte que personne n'affichera. `check-translations.mjs` ne voit que la faute
 * symétrique (clé présente dans une langue et absente d'`en.json`).
 *
 * Le contrôle lit l'AST plutôt que le texte des fichiers, pour distinguer deux formes :
 *   1. la citation directe — `t('shots.add')` : la clé apparaît telle quelle ;
 *   2. la clé **construite** — `` t(`shotgrid.domain.${d}`) ``, `'admin.group.' + g` : rien
 *      dans le code ne cite la clé finale. Le préfixe littéral (`shotgrid.domain.`) est
 *      alors relevé, et toute clé qui en descend est tenue pour employée. Un préfixe est
 *      donc une **famille** — la contrepartie de la construction dynamique, assumée.
 *
 * Le total est comparé à un plafond (`CEILING`). Baisser le plafond quand on descend,
 * jamais l'inverse.
 *
 * Usage : node scripts/check-unused-keys.mjs [--list] [--set=frontend|backend]
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Chemins ancrés sur la racine du dépôt et non sur le répertoire courant : la suite
// vitest du backend exécute ce fichier depuis `backend/`.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const at = (...parts) => join(repoRoot, ...parts);

const ts = createRequire(at('frontend', 'package.json'))('typescript');

/** Reliquat de clés mortes toléré — dette à résorber, jamais à relever. */
const CEILING = 0;

/**
 * Un jeu = un catalogue de référence et les sources qui l'emploient.
 *
 * Le backend cite des clés **du catalogue front** : une notification et une ligne de
 * journal ShotGrid voyagent en clé (`messageKey: 'notification.mentioned'`) et sont
 * traduites à l'affichage, dans la langue du lecteur et non dans celle du serveur. Ses
 * sources comptent donc pour le jeu frontend — les ignorer déclarerait mortes une
 * cinquantaine de clés bien vivantes.
 */
export const SETS = [
  {
    name: 'frontend',
    catalog: at('frontend/src/v2/i18n/messages/en.json'),
    roots: [at('frontend/src'), at('backend/src')],
  },
  {
    name: 'backend',
    catalog: at('backend/src/i18n/messages/en.json'),
    roots: [at('backend/src')],
  },
];

/** Clés du catalogue de référence, à plat. */
export const catalogKeys = (file) => Object.keys(JSON.parse(readFileSync(file, 'utf8')));

/**
 * Citations trouvées dans un source : clés entières et préfixes de clés construites.
 *
 * Aucun filtre sur l'appelant : une clé peut transiter par une constante (`const KEY =
 * 'task.status.todo'`), une prop `…Key`, un tableau ou un test. Ce qui compte est qu'elle
 * soit **nommée** quelque part ; la faute inverse (clé jamais traduite) a son contrôle.
 */
export function citations(source, fileName = 'x.ts') {
  const src = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const exact = new Set();
  const prefixes = new Set();

  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      exact.add(node.text);
      // `'admin.group.' + name` — la concaténation est l'autre façon de construire une clé.
      if (node.text.endsWith('.') && ts.isBinaryExpression(node.parent)) prefixes.add(node.text);
    } else if (ts.isTemplateExpression(node)) {
      // `` `shotgrid.entity.${kind}` `` — seule la tête est littérale.
      if (node.head.text.includes('.')) prefixes.add(node.head.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
  return { exact, prefixes };
}

function* sources(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // Les catalogues eux-mêmes ne citent rien : ils *sont* les clés.
      if (entry !== 'messages' && entry !== 'node_modules' && entry !== 'dist') yield* sources(full);
    } else if (/\.(tsx?|mjs)$/.test(entry)) {
      yield full;
    }
  }
}

/** Clés du catalogue qu'aucune source ne cite, ni entière ni par préfixe. */
export function unusedKeys(set) {
  const exact = new Set();
  const prefixes = new Set();
  for (const root of set.roots) {
    for (const file of sources(root)) {
      const found = citations(readFileSync(file, 'utf8'), file);
      for (const value of found.exact) exact.add(value);
      for (const value of found.prefixes) prefixes.add(value);
    }
  }
  return catalogKeys(set.catalog).filter(
    (key) => !exact.has(key) && ![...prefixes].some((p) => key.startsWith(p)),
  );
}

function main() {
  const only = process.argv.find((a) => a.startsWith('--set='))?.slice('--set='.length);
  const sets = SETS.filter((s) => !only || s.name === only);
  let total = 0;
  for (const set of sets) {
    const dead = unusedKeys(set);
    total += dead.length;
    console.log(
      `${set.name} : ${dead.length} clé(s) morte(s) sur ${catalogKeys(set.catalog).length} ` +
        `(${relative(repoRoot, set.catalog).split(sep).join('/')})`,
    );
    if (process.argv.includes('--list')) for (const key of dead) console.log('   ', key);
  }

  const ok = total <= CEILING;
  const color = ok ? '\x1b[0;32m' : '\x1b[0;31m';
  console.log(`${color}${ok ? '✓' : '✗'} clés de traduction mortes : ${total} (plafond ${CEILING})\x1b[0m`);
  if (!ok) console.error('  Relancer avec --list, puis retirer les clés des quatorze catalogues.');
  process.exit(ok ? 0 : 1);
}

// Importable pour les tests ; exécuté seulement quand on l'appelle directement.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
