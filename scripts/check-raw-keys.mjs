// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Detects **translation keys displayed as they are** — `task.status.todo` instead of "To do".
 *
 * This is the counterpart of `check-untranslated.mjs`, which hunts hard-coded text. The two faults are
 * opposite and neither check sees the other's: a bare key looks like a technical identifier (no space,
 * no accent, a dot in the middle), so the hard-coded text detector rightly sets it aside, and the screen
 * shows the key without any complaint.
 *
 * Two forms exist, and a purely syntactic check only catches the first:
 *   1. the forgotten literal: `<span>{'task.status.todo'}</span>`;
 *   2. the indirection: `<span>{TASK_STATUS_LABEL_KEY[s]}</span>`, where the expression has the type
 *      `MessageKey`. Nothing in the file's text looks like a key — it is the *type* that betrays the
 *      missing `t()`.
 *
 * Hence the use of the type checker rather than regular expressions: TypeScript is asked for the type of
 * each expression that reaches the screen, and those whose possible values are all catalogue keys are
 * reported. An already translated variable has the type `string`, never a union of literals: it does not
 * come up.
 *
 * The total is compared to a ceiling (`CEILING`). Lower the ceiling when going down, never the other way.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const ts = createRequire(resolve('frontend/package.json'))('typescript');

const PROJECT = 'frontend/tsconfig.json';
const CATALOG = 'frontend/src/v2/i18n/messages/en.json';

/** Tolerated remainder of bare keys — debt to be paid down, never raised. */
const CEILING = 0;

/** Props whose value reaches the user (on screen or through a screen reader). */
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

/** Functions that speak to the user: their text argument is displayed. */
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
 * Props that *deliberately* carry a key, leaving it to the receiving component to translate it. Naming
 * them this way is the correct way to pass an untranslated key around — the check relies on it rather
 * than guessing.
 */
export const isKeyProp = (name) => /Key$/.test(name);

/** Keys of the reference catalogue (English) — the set the types are checked against. */
export const loadCatalogKeys = (catalog = CATALOG) =>
  new Set(Object.keys(JSON.parse(readFileSync(catalog, 'utf8'))));

function loadProgram() {
  const configPath = resolve(PROJECT);
  const raw = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, resolve('frontend'));
  return ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });
}

/**
 * True when *all* the possible values of the type are catalogue keys. A widened `string` type does not
 * come up: it may already contain the translation.
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

/** Is the expression already the argument of a call — `t(key)`, `tr(key)`? */
function insideTranslator(node) {
  const parent = node.parent;
  return parent && ts.isCallExpression(parent) && parent.arguments.includes(node);
}

function scan(file, checker, keys, findings) {
  const visit = (node) => {
    // 1. JSX text: <span>{expr}</span>
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

    // 2. Visible prop: title={expr}, label="task.status.todo"
    if (ts.isJsxAttribute(node) && node.name && ts.isIdentifier(node.name)) {
      const name = node.name.text;
      if (VISIBLE_PROPS.has(name) && !isKeyProp(name) && node.initializer) {
        const value = ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer;
        if (value && !insideTranslator(value) && isMessageKeyType(checker.getTypeAtLocation(value), keys)) {
          report(findings, value, file, `prop « ${name} »`);
        }
      }
    }

    // 3. Function that speaks to the user: toast.error(expr)
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

    // 4. Interpolation: `${key} : ${count}`. A key has no business in an assembled
    //    sentence — unlike a URL or a CSS class, where one never meets one.
    if (ts.isTemplateSpan(node)) {
      if (isMessageKeyType(checker.getTypeAtLocation(node.expression), keys)) {
        report(findings, node.expression, file, 'interpolation');
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(file);
}

/** Walks the frontend TypeScript program and returns the bare keys found. */
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

// Importable for the tests; only runs when called directly.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
