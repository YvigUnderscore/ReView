// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Input fields **without an accessible name**: measurement and ratchet.
 *
 * A bare `<select>` is announced as "dropdown" and nothing else: on a kanban page, where each card
 * carries its status selector, a screen reader lists indistinguishable controls. `jsx-a11y` does not
 * see it: `label-has-associated-control` only acts if a `<label>` already exists, and
 * `control-has-associated-label` belongs to the strict preset, which is not enabled.
 *
 * The check is syntactic: no rendering, no accessibility tree. It flags the input
 * tags that have **no** name source (`aria-label`, `aria-labelledby`,
 * `title`, an associated `id`, an enclosing label, or props passed through by a primitive). The
 * total is compared to a ceiling, which is lowered as we go and never raised.
 */

/**
 * Tolerated remainder of anonymous fields: a quantified debt, to be brought down to 0 and
 * never raised. Twenty-four on 2026-08-22, seventeen actually reached; three on
 * 2026-09-08, once the selectors of review, assembly and ShotGrid were named:
 * with `aria-label` when the control is alone, with the label of the row linked through
 * `htmlFor` where one already existed on screen (ShotGrid settings). The three that
 * remain are fields of administration panels; the kanban status selector, for its part,
 * is named (next test).
 */
const CEILING = 3;

const FIELDS = new Set(['input', 'select', 'textarea']);

/**
 * Attributes that give, or pass on, an accessible name. `title` and `placeholder`
 * count: the accname algorithm uses them as a last resort. A poor name, then,
 * but not an absent one: the check targets complete anonymity, the only clear fault.
 */
const NAMING_ATTRS = new Set(['aria-label', 'aria-labelledby', 'id', 'title', 'placeholder']);

/** Elements whose content is a label: an enclosing `<label>` names its control. */
const LABELLING_TAGS = /^(label|Label|.*Field|Field)$/;

function* sources(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* sources(full);
    else if (entry.endsWith('.tsx') && !entry.includes('.test.')) yield full;
  }
}

const tagOf = (node: ts.JsxSelfClosingElement | ts.JsxOpeningElement) => node.tagName.getText();

/** Is the control enclosed by a label (`Field` pattern, `<label>…</label>`)? */
function insideLabel(node: ts.Node): boolean {
  for (let cur = node.parent; cur; cur = cur.parent) {
    if (ts.isJsxElement(cur) && LABELLING_TAGS.test(cur.openingElement.tagName.getText())) return true;
  }
  return false;
}

function isAnonymous(node: ts.JsxSelfClosingElement | ts.JsxOpeningElement): boolean {
  let hidden = false;
  for (const attr of node.attributes.properties) {
    // `{...props}`: a primitive passes on the name its caller gives it.
    if (ts.isJsxSpreadAttribute(attr)) return false;
    if (!ts.isJsxAttribute(attr)) continue;
    const name = attr.name.getText();
    if (NAMING_ATTRS.has(name)) return false;
    // `type="hidden"`, and the hidden file picker behind a button
    // (`className="hidden"`): `display: none` removes them from the accessibility tree,
    // so it is the visible button that carries the name.
    if (attr.initializer && ts.isStringLiteral(attr.initializer)) {
      if (name === 'type' && attr.initializer.text === 'hidden') hidden = true;
      if (name === 'className' && /\bhidden\b/.test(attr.initializer.text)) hidden = true;
    }
  }
  return !hidden && !insideLabel(node);
}

/** Anonymous fields of the frontend, as `file:line` and tag. */
function anonymousFields(root = 'src'): string[] {
  const found: string[] = [];
  for (const file of sources(root)) {
    const src = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const visit = (node: ts.Node): void => {
      if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && FIELDS.has(tagOf(node))) {
        if (isAnonymous(node)) {
          const { line } = src.getLineAndCharacterOfPosition(node.getStart(src));
          found.push(`${file.split(/[\\/]/).join('/')}:${line + 1} <${tagOf(node)}>`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(src);
  }
  return found;
}

/**
 * This check walks the whole of `src` and parses each `.tsx` with the
 * TypeScript compiler: a few tens of milliseconds on a development machine, nearly
 * four seconds on a shared runner, and more under the concurrency of the whole
 * suite, where vitest's five-second ceiling was exceeded.
 */
describe('accessible names of input fields', { timeout: 60_000 }, () => {
  it('does not let the count of anonymous fields go up', () => {
    const found = anonymousFields();
    expect(found.length, `champs sans nom accessible :\n${found.join('\n')}`).toBeLessThanOrEqual(CEILING);
  });

  it('names the status selector present on each kanban card', () => {
    const source = readFileSync('src/v2/components/shotgrid/PipelineStatusSelect.tsx', 'utf8');
    // Two `<select>`: the project's reference list and the fallback to the frozen enumeration.
    expect(source.match(/aria-label=/g)).toHaveLength(2);
  });
});

describe('detection', () => {
  it('recognizes name sources and their absence', () => {
    const parse = (source: string) =>
      ts.createSourceFile('T.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const firstField = (source: string) => {
      let found: ts.JsxSelfClosingElement | undefined;
      const visit = (node: ts.Node): void => {
        if (!found && ts.isJsxSelfClosingElement(node) && FIELDS.has(tagOf(node))) found = node;
        ts.forEachChild(node, visit);
      };
      visit(parse(source));
      return found!;
    };

    expect(isAnonymous(firstField('const A = () => <select />;'))).toBe(true);
    expect(isAnonymous(firstField('const A = () => <select aria-label="Status" />;'))).toBe(false);
    expect(isAnonymous(firstField('const A = (p) => <input {...p} />;'))).toBe(false);
    expect(isAnonymous(firstField('const A = () => <input type="hidden" />;'))).toBe(false);
    expect(isAnonymous(firstField('const A = () => <label>Name<input /></label>;'))).toBe(false);
  });
});
