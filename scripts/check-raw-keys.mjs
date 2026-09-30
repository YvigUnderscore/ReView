// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Détecte les **clés de traduction affichées telles quelles** — `task.status.todo` au lieu
 * de « À faire ».
 *
 * C'est le symétrique de `check-untranslated.mjs`, qui traque le texte écrit en dur. Les
 * deux fautes sont opposées et aucun des deux contrôles ne voit celle de l'autre : une clé
 * nue ressemble à un identifiant technique (pas d'espace, pas d'accent, un point au milieu),
 * donc le détecteur de texte en dur l'écarte — à raison — et l'écran affiche la clé sans que
 * rien ne proteste.
 *
 * Deux formes existent, et un contrôle purement syntaxique n'attrape que la première :
 *   1. le littéral oublié : `<span>{'task.status.todo'}</span>` ;
 *   2. l'indirection : `<span>{TASK_STATUS_LABEL_KEY[s]}</span>`, où l'expression a le type
 *      `MessageKey`. Rien dans le texte du fichier ne ressemble à une clé — c'est le *type*
 *      qui trahit l'oubli du `t()`.
 *
 * D'où l'usage du vérificateur de types plutôt que d'expressions régulières : on demande à
 * TypeScript le type de chaque expression qui atteint l'écran, et on signale celles dont
 * toutes les valeurs possibles sont des clés du catalogue. Une variable déjà traduite a le
 * type `string`, jamais une union de littéraux : elle ne remonte pas.
 *
 * Le total est comparé à un plafond (`CEILING`). Baisser le plafond quand on descend,
 * jamais l'inverse.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const ts = createRequire(resolve('frontend/package.json'))('typescript');

const PROJECT = 'frontend/tsconfig.json';
const CATALOG = 'frontend/src/v2/i18n/messages/en.json';

/** Reliquat de clés nues toléré — dette à résorber, jamais à relever. */
const CEILING = 0;

/** Props dont la valeur atteint l'utilisateur (à l'écran ou via un lecteur d'écran). */
export const VISIBLE_PROPS = new Set([
  'alt',
  'aria-label',
  'aria-valuetext',
  'confirmLabel',
  'cancelLabel',
  'description',
  'emptyLabel',
  'heading',
  'hint',
  'label',
  'message',
  'placeholder',
  'subtitle',
  'title',
  'tooltip',
]);

/** Fonctions qui parlent à l'utilisateur : leur argument texte est affiché. */
export const SPEAKING_CALLS = new Set([
  'alert',
  'confirm',
  'prompt',
  'toast',
  'error',
  'success',
  'info',
  'warning',
]);

/**
 * Props qui transportent *volontairement* une clé, à charge du composant destinataire de la
 * traduire. Les nommer ainsi est la façon correcte de faire circuler une clé non traduite —
 * le contrôle s'y fie plutôt que de deviner.
 */
export const isKeyProp = (name) => /Key$/.test(name);

/** Clés du catalogue de référence (anglais) — l'ensemble auquel les types sont confrontés. */
export const loadCatalogKeys = (catalog = CATALOG) =>
  new Set(Object.keys(JSON.parse(readFileSync(catalog, 'utf8'))));

function loadProgram() {
  const configPath = resolve(PROJECT);
  const raw = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, resolve('frontend'));
  return ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });
}

/**
 * Vrai quand *toutes* les valeurs possibles du type sont des clés du catalogue. Un type
 * `string` élargi ne remonte pas : il peut déjà contenir la traduction.
 */
export function isMessageKeyType(type, keys) {
  const parts = type.isUnion() ? type.types : [type];
  if (parts.length === 0) return false;
  return parts.every((part) => {
    if (!part.isStringLiteral()) return false;
    return keys.has(part.value);
  });
}

function report(findings, node, file, what) {
  const { line, character } = file.getLineAndCharacterOfPosition(node.getStart(file));
  findings.push({
    file: relative(process.cwd(), file.fileName).split(sep).join('/'),
    line: line + 1,
    column: character + 1,
    text: node.getText(file).slice(0, 80).replace(/\s+/g, ' '),
    what,
  });
}

/** L'expression est-elle déjà l'argument d'un appel — `t(key)`, `tr(key)` ? */
function insideTranslator(node) {
  const parent = node.parent;
  return parent && ts.isCallExpression(parent) && parent.arguments.includes(node);
}

function scan(file, checker, keys, findings) {
  const visit = (node) => {
    // 1. Texte JSX : <span>{expr}</span>
    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      node.parent &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
    ) {
      if (
        !insideTranslator(node.expression) &&
        isMessageKeyType(checker.getTypeAtLocation(node.expression), keys)
      ) {
        report(findings, node.expression, file, 'texte JSX');
      }
    }

    // 2. Prop visible : title={expr}, label="task.status.todo"
    if (ts.isJsxAttribute(node) && node.name && ts.isIdentifier(node.name)) {
      const name = node.name.text;
      if (VISIBLE_PROPS.has(name) && !isKeyProp(name) && node.initializer) {
        const value = ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer;
        if (value && !insideTranslator(value) && isMessageKeyType(checker.getTypeAtLocation(value), keys)) {
          report(findings, value, file, `prop « ${name} »`);
        }
      }
    }

    // 3. Fonction qui parle à l'utilisateur : toast.error(expr)
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : ts.isIdentifier(callee)
          ? callee.text
          : '';
      if (SPEAKING_CALLS.has(name)) {
        for (const arg of node.arguments) {
          if (!insideTranslator(arg) && isMessageKeyType(checker.getTypeAtLocation(arg), keys)) {
            report(findings, arg, file, `appel « ${name} »`);
          }
        }
      }
    }

    // 4. Interpolation : `${key} : ${count}`. Une clé n'a rien à faire dans une phrase
    //    assemblée — contrairement à une URL ou une classe CSS, où l'on n'en croise jamais.
    if (ts.isTemplateSpan(node)) {
      if (isMessageKeyType(checker.getTypeAtLocation(node.expression), keys)) {
        report(findings, node.expression, file, 'interpolation');
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(file);
}

/** Parcourt le programme TypeScript du frontend et rend les clés nues trouvées. */
export function collectRawKeys() {
  const keys = loadCatalogKeys();
  const program = loadProgram();
  const checker = program.getTypeChecker();
  const findings = [];
  for (const file of program.getSourceFiles()) {
    if (file.isDeclarationFile) continue;
    if (!file.fileName.includes('/src/')) continue;
    if (/\.(test|spec)\.tsx?$/.test(file.fileName)) continue;
    scan(file, checker, keys, findings);
  }
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return findings;
}

function main() {
  const findings = collectRawKeys();
  for (const f of findings) {
    console.log(`${f.file}:${f.line}:${f.column}  ${f.what} — ${f.text}`);
  }
  const total = findings.length;
  const ok = total <= CEILING;
  const color = ok ? '\x1b[0;32m' : '\x1b[0;31m';
  console.log(
    `${color}${ok ? '✓' : '✗'} clés de traduction affichées brutes : ${total} (plafond ${CEILING})\x1b[0m`,
  );
  process.exit(ok ? 0 : 1);
}

// Importable pour les tests ; exécuté seulement quand on l'appelle directement.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
